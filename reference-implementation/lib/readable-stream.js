var assert = require('assert');
import * as helpers from './helpers';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';
import CountQueuingStrategy from './count-queuing-strategy';

export default class ReadableStream {
  constructor({
    start = () => {},
    pull = () => {},
    cancel = () => {},
    strategy = defaultReadableStreamStrategy
  } = {}) {
    if (typeof start !== 'function') {
      throw new TypeError('start must be a function or undefined');
    }
    if (typeof pull !== 'function') {
      throw new TypeError('pull must be a function or undefined');
    }
    if (typeof cancel !== 'function') {
      throw new TypeError('cancel must be a function or undefined');
    }

    this._onPull = pull;
    this._onCancel = cancel;
    this._strategy = strategy;
    this._initWaitPromise();
    this._initClosedPromise();
    this._queue = [];
    this._state = 'waiting';
    this._started = false;
    this._draining = false;
    this._pulling = false;

    this._enqueue = CreateReadableStreamEnqueueFunction(this);
    this._close = CreateReadableStreamCloseFunction(this);
    this._error = CreateReadableStreamErrorFunction(this);

    var startResult = start(this._enqueue, this._close, this._error);
    this._startedPromise = Promise.resolve(startResult);
    this._startedPromise.then(() => {
      this._started = true;
      this._startedPromise = undefined;
    });
    this._startedPromise.catch(r => this._error(r));
  }

  get closed() {
    return this._closedPromise;
  }

  get state() {
    return this._state;
  }

  cancel(reason) {
    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }
    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }
    if (this._state === 'waiting') {
      this._resolveWaitPromise(undefined);
    }

    this._queue = [];
    this._state = 'closed';
    this._resolveClosedPromise(undefined);

    var sourceCancelPromise = helpers.promiseCall(this._onCancel, reason);
    return sourceCancelPromise.then(() => undefined);
  }

  pipeThrough({ writable, readable }, options) {
    if (!helpers.typeIsObject(writable)) {
      throw new TypeError('A transform stream must have an writable property that is an object.');
    }

    if (!helpers.typeIsObject(readable)) {
      throw new TypeError('A transform stream must have a readable property that is an object.');
    }

    this.pipeTo(writable, options);
    return readable;
  }

  pipeTo(dest, { preventClose, preventAbort, preventCancel } = {}) {
    var source = this;
    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    var resolvePipeToPromise;
    var rejectPipeToPromise;

    return new Promise((resolve, reject) => {
      resolvePipeToPromise = resolve;
      rejectPipeToPromise = reject;

      doPipe();
    });

    function doPipe() {
      for (;;) {
        var ds = dest.state;
        if (ds === 'writable') {
          if (source.state === 'readable') {
            dest.write(source.read());
            continue;
          } else if (source.state === 'waiting') {
            Promise.race([source.wait(), dest.closed]).then(doPipe, doPipe);
          } else if (source.state === 'errored') {
            source.wait().catch(abortDest);
          } else if (source.state === 'closed') {
            closeDest();
          }
        } else if (ds === 'waiting') {
          if (source.state === 'readable') {
            Promise.race([source.closed, dest.wait()]).then(doPipe, doPipe);
          } else if (source.state === 'waiting') {
            Promise.race([source.wait(), dest.wait()]).then(doPipe, doPipe);
          } else if (source.state === 'errored') {
            source.wait().catch(abortDest);
          } else if (source.state === 'closed') {
            closeDest();
          }
        } else if (ds === 'errored' && (source.state === 'readable' || source.state === 'waiting')) {
          dest.wait().catch(cancelSource);
        } else if ((ds === 'closing' || ds === 'closed') &&
            (source.state === 'readable' || source.state === 'waiting')) {
          cancelSource(new TypeError('destination is closing or closed and cannot be piped to anymore'));
        }
        return;
      }
    }

    function cancelSource(reason) {
      if (preventCancel === false) {
        source.cancel(reason);
      }
      rejectPipeToPromise(reason);
    }

    function closeDest() {
      if (preventClose === false) {
        dest.close().then(resolvePipeToPromise, rejectPipeToPromise);
      } else {
        resolvePipeToPromise();
      }
    }

    function abortDest(reason) {
      if (preventAbort === false) {
        dest.abort(reason);
      }
      rejectPipeToPromise(reason);
    }
  }

  read() {
    if (this._state === 'waiting') {
      throw new TypeError('no chunks available (yet)');
    }
    if (this._state === 'closed') {
      throw new TypeError('stream has already been consumed');
    }
    if (this._state === 'errored') {
      throw this._storedError;
    }

    assert(this._state === 'readable', `stream state ${this._state} is invalid`);
    assert(this._queue.length > 0, 'there must be chunks available to read');

    var chunk = DequeueValue(this._queue);

    if (this._queue.length === 0) {
      if (this._draining === true) {
        this._state = 'closed';
        this._resolveClosedPromise(undefined);
      } else {
        this._state = 'waiting';
        this._initWaitPromise();
        CallOrScheduleReadableStreamPull(this);
      }
    }

    return chunk;
  }

  wait() {
    if (this._state === 'waiting') {
      CallOrScheduleReadableStreamPull(this);
    }

    return this._waitPromise;
  }

  _initWaitPromise() {
    this._waitPromise = new Promise((resolve, reject) => {
      this._waitPromise_resolve = resolve;
      this._waitPromise_reject = reject;
    });
  }

  _initClosedPromise() {
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });
  }

  // Note: The resolve function and reject function are cleared when the
  // corresponding promise is resolved or rejected. This is for debugging. This
  // makes extra resolve/reject calls for the same promise fail so that we can
  // detect unexpected extra resolve/reject calls that may be caused by bugs in
  // the algorithm.

  _resolveWaitPromise(value) {
    this._waitPromise_resolve(value);
    this._waitPromise_resolve = null;
    this._waitPromise_reject = null;
  }

  _rejectWaitPromise(reason) {
    this._waitPromise_reject(reason);
    this._waitPromise_resolve = null;
    this._waitPromise_reject = null;
  }

  _resolveClosedPromise(value) {
    this._closedPromise_resolve(value);
    this._closedPromise_resolve = null;
    this._closedPromise_reject = null;
  }

  _rejectClosedPromise(reason) {
    this._closedPromise_reject(reason);
    this._closedPromise_resolve = null;
    this._closedPromise_reject = null;
  }
}

function CallOrScheduleReadableStreamPull(stream) {
  if (stream._pulling === true) {
    return undefined;
  }
  stream._pulling = true;

  if (stream._started === false) {
    stream._startedPromise.then(() => {
      CallReadableStreamPull(stream);
    });
    return undefined;
  } else {
    return CallReadableStreamPull(stream);
  }
}

function CallReadableStreamPull(stream) {
  try {
    stream._onPull(
      stream._enqueue,
      stream._close,
      stream._error
    );
  } catch (pullResultE) {
    return stream._error(pullResultE);
  }
  return undefined;
}

function CreateReadableStreamCloseFunction(stream) {
  return () => {
    if (stream._state === 'waiting') {
      stream._resolveWaitPromise(undefined);
      stream._resolveClosedPromise(undefined);
      stream._state = 'closed';
    }
    if (stream._state === 'readable') {
      stream._draining = true;
    }
  };
}

function CreateReadableStreamEnqueueFunction(stream) {
  return chunk => {
    if (stream._state === 'errored' || stream._state === 'closed') {
      return false;
    }

    if (stream._draining === true) {
      throw new TypeError('stream has already been closed');
    }

    var chunkSize;
    try {
      chunkSize = stream._strategy.size(chunk);
    } catch (chunkSizeE) {
      stream._error(chunkSizeE);
      throw chunkSizeE;
    }

    EnqueueValueWithSize(stream._queue, chunk, chunkSize);
    stream._pulling = false;

    var queueSize = GetTotalQueueSize(stream._queue);
    var shouldApplyBackpressure;
    try {
      shouldApplyBackpressure = Boolean(stream._strategy.shouldApplyBackpressure(queueSize));
    } catch (shouldApplyBackpressureE) {
      stream._error(shouldApplyBackpressureE);
      throw shouldApplyBackpressureE;
    }

    if (stream._state === 'waiting') {
      stream._state = 'readable';
      stream._resolveWaitPromise(undefined);
    }

    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  };
}

function CreateReadableStreamErrorFunction(stream) {
  return e => {
    if (stream._state === 'waiting') {
      stream._state = 'errored';
      stream._storedError = e;
      stream._rejectWaitPromise(e);
      stream._rejectClosedPromise(e);
    }
    else if (stream._state === 'readable') {
      stream._queue = [];
      stream._state = 'errored';
      stream._storedError = e;

      stream._waitPromise = Promise.reject(e);
      stream._waitPromise_resolve = null;
      stream._waitPromise_reject = null;

      stream._rejectClosedPromise(e);
    }
  };
}

var defaultReadableStreamStrategy = {
  shouldApplyBackpressure(queueSize) {
    assert(typeof queueSize === 'number' && !Number.isNaN(queueSize));
    return queueSize > 1;
  },
  size() {
    return 1;
  }
};
