var assert = require('assert');
import * as helpers from './helpers';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';
import CountQueuingStrategy from './count-queuing-strategy';
import ExclusiveStreamReader from './exclusive-stream-reader';

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
    this._initReadyPromise();
    this._initClosedPromise();
    this._queue = [];
    this._state = 'waiting';
    this._started = false;
    this._draining = false;
    this._pulling = false;
    this._reader = undefined;

    this._enqueue = CreateReadableStreamEnqueueFunction(this);
    this._close = CreateReadableStreamCloseFunction(this);
    this._error = CreateReadableStreamErrorFunction(this);

    var startResult = start(this._enqueue, this._close, this._error);
    Promise.resolve(startResult).then(
      () => {
        this._started = true;
        CallReadableStreamPull(this);
      },
      r => this._error(r)
    );
  }

  get closed() {
    return this._closedPromise;
  }

  get state() {
    if (this._reader !== undefined) {
      return 'waiting';
    }

    return this._state;
  }

  cancel(reason) {
    if (this._reader !== undefined) {
      return Promise.reject(
        new TypeError('This stream is locked to a single exclusive reader and cannot be cancelled directly'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }
    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }
    if (this._state === 'waiting') {
      this._resolveReadyPromise(undefined);
    }

    this._queue = [];
    CloseReadableStream(this);

    var sourceCancelPromise = helpers.promiseCall(this._onCancel, reason);
    return sourceCancelPromise.then(() => undefined);
  }

  getReader() {
    if (this._state === 'closed') {
      throw new TypeError('The stream has already been closed, so a reader cannot be acquired.');
    }
    if (this._state === 'errored') {
      throw this._storedError;
    }

    return new ExclusiveStreamReader(this);
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
    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    var source;
    var resolvePipeToPromise;
    var rejectPipeToPromise;

    return new Promise((resolve, reject) => {
      resolvePipeToPromise = resolve;
      rejectPipeToPromise = reject;

      source = this.getReader();
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
            Promise.race([source.ready, dest.closed]).then(doPipe, doPipe);
          } else if (source.state === 'errored') {
            source.closed.catch(abortDest);
          } else if (source.state === 'closed') {
            closeDest();
          }
        } else if (ds === 'waiting') {
          if (source.state === 'readable') {
            Promise.race([source.closed, dest.ready]).then(doPipe, doPipe);
          } else if (source.state === 'waiting') {
            Promise.race([source.ready, dest.ready]).then(doPipe);
          } else if (source.state === 'errored') {
            source.closed.catch(abortDest);
          } else if (source.state === 'closed') {
            closeDest();
          }
        } else if (ds === 'errored' && (source.state === 'readable' || source.state === 'waiting')) {
          dest.closed.catch(cancelSource);
        } else if ((ds === 'closing' || ds === 'closed') &&
            (source.state === 'readable' || source.state === 'waiting')) {
          cancelSource(new TypeError('destination is closing or closed and cannot be piped to anymore'));
        }
        return;
      }
    }

    function cancelSource(reason) {
      if (preventCancel === false) {
        // implicitly releases the lock
        source.cancel(reason);
      } else {
        source.releaseLock();
      }
      rejectPipeToPromise(reason);
    }

    function closeDest() {
      source.releaseLock();
      if (preventClose === false) {
        dest.close().then(resolvePipeToPromise, rejectPipeToPromise);
      } else {
        resolvePipeToPromise();
      }
    }

    function abortDest(reason) {
      source.releaseLock();
      if (preventAbort === false) {
        dest.abort(reason);
      }
      rejectPipeToPromise(reason);
    }
  }

  read() {
    if (this._reader !== undefined) {
      throw new TypeError('This stream is locked to a single exclusive reader and cannot be read from directly');
    }

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
        CloseReadableStream(this);
      } else {
        this._state = 'waiting';
        this._initReadyPromise();
      }
    }

    CallReadableStreamPull(this);

    return chunk;
  }

  get ready() {
    if (this._reader !== undefined) {
      return this._reader._lockReleased;
    }

    return this._readyPromise;
  }

  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyPromise_resolve = resolve;
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

  _resolveReadyPromise(value) {
    this._readyPromise_resolve(value);
    this._readyPromise_resolve = null;
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

function CallReadableStreamPull(stream) {
  if (stream._pulling === true || stream._draining === true || stream._started === false ||
      stream._state === 'closed' || stream._state === 'errored') {
    return undefined;
  }

  var shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);
  if (shouldApplyBackpressure === true) {
    return undefined;
  }

  stream._pulling = true;

  try {
    stream._onPull(
      stream._enqueue,
      stream._close,
      stream._error
    );
  } catch (pullResultE) {
    stream._error(pullResultE);
    throw pullResultE;
  }

  return undefined;
}

function CreateReadableStreamCloseFunction(stream) {
  return () => {
    if (stream._state === 'waiting') {
      stream._resolveReadyPromise(undefined);
      return CloseReadableStream(stream);
    }
    if (stream._state === 'readable') {
      stream._draining = true;
    }
  };
}

function CreateReadableStreamEnqueueFunction(stream) {
  return chunk => {
    if (stream._state === 'errored') {
      throw stream._storedError;
    }

    if (stream._state === 'closed') {
      throw new TypeError('stream is closed');
    }

    if (stream._draining === true) {
      throw new TypeError('stream is draining');
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

    var shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);

    if (stream._state === 'waiting') {
      stream._state = 'readable';
      stream._resolveReadyPromise(undefined);
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
      stream._resolveReadyPromise(undefined);
    }
    if (stream._state === 'readable') {
      stream._queue = [];
    }
    if (stream._state === 'waiting' || stream._state === 'readable') {
      stream._state = 'errored';
      stream._storedError = e;
      stream._rejectClosedPromise(e);
      if (stream._reader !== undefined) {
        stream._reader.releaseLock();
      }
    }
  };
}

function ShouldReadableStreamApplyBackpressure(stream) {
  var queueSize = GetTotalQueueSize(stream._queue);
  var shouldApplyBackpressure;
  try {
    shouldApplyBackpressure = Boolean(stream._strategy.shouldApplyBackpressure(queueSize));
  } catch (shouldApplyBackpressureE) {
    stream._error(shouldApplyBackpressureE);
    throw shouldApplyBackpressureE;
  }

  return shouldApplyBackpressure;
}

function CloseReadableStream(stream) {
  stream._state = 'closed';
  stream._resolveClosedPromise(undefined);

  if (stream._reader !== undefined) {
    stream._reader.releaseLock();
  }

  return undefined;
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
