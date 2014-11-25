var assert = require('assert');
import * as helpers from './helpers';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize, PeekQueueValue } from './queue-with-sizes';
import CountQueuingStrategy from './count-queuing-strategy';

export default class WritableStream {
  constructor({
    start = () => {},
    write = () => {},
    close = () => {},
    abort = () => {},
    strategy = defaultWritableStreamStrategy
  } = {}) {
    if (typeof start !== 'function') {
      throw new TypeError('start must be a function or undefined');
    }
    if (typeof write !== 'function') {
      throw new TypeError('write must be a function or undefined');
    }
    if (typeof close !== 'function') {
      throw new TypeError('close must be a function or undefined');
    }
    if (typeof abort !== 'function') {
      throw new TypeError('abort must be a function or undefined');
    }

    this._onWrite = write;
    this._onClose = close;
    this._onAbort = abort;
    this._strategy = strategy;

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    this._readyPromise = Promise.resolve(undefined);
    this._readyPromise_resolve = null;
    this._readyPromise_reject = null;

    this._queue = [];
    this._state = 'writable';
    this._started = false;
    this._writing = false;

    this._error = CreateWritableStreamErrorFunction(this);

    SyncWritableStreamStateWithQueue(this);

    var startResult = start(this._error);
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

  abort(reason) {
    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }
    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    this._error(reason);
    var sinkAbortPromise = helpers.promiseCall(this._onAbort, reason);
    return sinkAbortPromise.then(() => undefined);
  }

  close() {
    if (this._state === 'closing') {
      return Promise.reject(new TypeError('cannot close an already-closing stream'));
    }
    if (this._state === 'closed') {
      return Promise.reject(new TypeError('cannot close an already-closed stream'));
    }
    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }
    if (this._state === 'writable') {
      this._readyPromise = Promise.reject(new TypeError('stream has already been closed'));
      this._readyPromise_resolve = null;
      this._readyPromise_reject = null;
    }
    if (this._state === 'waiting') {
      this._readyPromise_reject(new TypeError('stream has already been closed'));
    }

    this._state = 'closing';
    EnqueueValueWithSize(this._queue, 'close', 0);
    CallOrScheduleWritableStreamAdvanceQueue(this);

    return this._closedPromise;
  }

  get ready() {
    return this._readyPromise;
  }

  write(chunk) {
    if (this._state === 'closing') {
      return Promise.reject(new TypeError('cannot write while stream is closing'));
    }
    if (this._state === 'closed') {
      return Promise.reject(new TypeError('cannot write after stream is closed'));
    }
    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._state === 'waiting' || this._state === 'writable');

    var chunkSize;
    try {
      chunkSize = this._strategy.size(chunk);
    } catch (chunkSizeE) {
      this._error(chunkSizeE);
      return Promise.reject(chunkSizeE);
    }

    var resolver, rejecter;
    var promise = new Promise((resolve, reject) => {
      resolver = resolve;
      rejecter = reject;
    });

    var writeRecord = { promise: promise, chunk: chunk, _resolve: resolver, _reject: rejecter };
    try {
      EnqueueValueWithSize(this._queue, writeRecord, chunkSize);
    } catch (enqueueResultE) {
      this._error(enqueueResultE);
      return Promise.reject(enqueueResultE);
    }

    try {
      SyncWritableStreamStateWithQueue(this);
    } catch (syncResultE) {
      this._error(syncResultE);
      return promise;
    }

    CallOrScheduleWritableStreamAdvanceQueue(this);
    return promise;
  }
}

function CallOrScheduleWritableStreamAdvanceQueue(stream) {
  if (stream._started === false) {
    stream._startedPromise.then(() => {
      WritableStreamAdvanceQueue(stream);
    });
    return undefined;
  }

  if (stream._started === true) {
    return WritableStreamAdvanceQueue(stream);
  }
}

function CloseWritableStream(stream) {
  assert(stream._state === 'closing', 'stream must be in closing state while calling CloseWritableStream');

  var sinkClosePromise = helpers.promiseCall(stream._onClose);
  sinkClosePromise.then(
    () => {
      if (stream._state === 'errored') {
        return;
      }

      assert(stream._state === 'closing');

      stream._closedPromise_resolve(undefined);
      stream._state = 'closed';
    },
    r => {
      stream._error(r);
    }
  );
}

function CreateWritableStreamErrorFunction(stream) {
  return e => {
    if (stream._state === 'closed' || stream._state === 'errored') {
      return undefined;
    }

    while (stream._queue.length > 0) {
      var writeRecord = DequeueValue(stream._queue);
      if (writeRecord !== 'close') {
        writeRecord._reject(e);
      }
    }

    stream._storedError = e;

    if (stream._state === 'writable' || stream._state === 'closing') {
      stream._readyPromise = Promise.reject(e);
      stream._readyPromise_resolve = null;
      stream._readyPromise_reject = null;
    }
    if (stream._state === 'waiting') {
      stream._readyPromise_reject(e);
    }
    stream._closedPromise_reject(e);
    stream._state = 'errored';
  };
}

function SyncWritableStreamStateWithQueue(stream) {
  if (stream._state === 'closing') {
    return undefined;
  }

  assert(stream._state === 'writable' || stream._state === 'waiting',
    'stream must be in a writable or waiting state while calling SyncWritableStreamStateWithQueue');

  if (stream._state === 'waiting' && stream._queue.length === 0) {
    stream._state = 'writable';
    stream._readyPromise_resolve(undefined);
    return undefined;
  }

  var queueSize = GetTotalQueueSize(stream._queue);
  var shouldApplyBackpressure = Boolean(stream._strategy.shouldApplyBackpressure(queueSize));

  if (shouldApplyBackpressure === true && stream._state === 'writable') {
    stream._state = 'waiting';
    stream._readyPromise = new Promise((resolve, reject) => {
      stream._readyPromise_resolve = resolve;
      stream._readyPromise_reject = reject;
    });
  }

  if (shouldApplyBackpressure === false && stream._state === 'waiting') {
    stream._state = 'writable';
    stream._readyPromise_resolve(undefined);
  }

  return undefined;
}

function WritableStreamAdvanceQueue(stream) {
  if (stream._queue.length === 0 || stream._writing === true) {
    return undefined;
  }

  var writeRecord = PeekQueueValue(stream._queue);

  if (writeRecord === 'close') {
    assert(stream._state === 'closing', 'can\'t process final write record unless already closing');
    DequeueValue(stream._queue);
    assert(stream._queue.length === 0, 'queue must be empty once the final write record is dequeued');
    return CloseWritableStream(stream);
  } else {
    stream._writing = true;

    helpers.promiseCall(stream._onWrite, writeRecord.chunk).then(
      () => {
        if (stream._state === 'errored') {
          return;
        }

        stream._writing = false;

        writeRecord._resolve(undefined);

        DequeueValue(stream._queue);
        try {
          SyncWritableStreamStateWithQueue(stream);
        } catch (syncResultE) {
          stream._error(syncResultE);
          return;
        }
        return WritableStreamAdvanceQueue(stream);
      },
      r => {
        stream._error(r);
      }
    )
    .catch(e => process.nextTick(() => { throw e; })); // to catch assertion failures
  }
}

var defaultWritableStreamStrategy = {
  shouldApplyBackpressure(queueSize) {
    assert(typeof queueSize === 'number' && !Number.isNaN(queueSize));
    return queueSize > 0;
  },
  size() {
    return 1;
  }
};
