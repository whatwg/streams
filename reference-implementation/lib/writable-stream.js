var assert = require('assert');
module helpers from './helpers';
import CountQueuingStrategy from './count-queuing-strategy';

export default class WritableStream {
  constructor({
    start = () => {},
    write = () => {},
    close = () => {},
    abort = () => {},
    strategy = new CountQueuingStrategy({ highWaterMark: 0 })
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
    if (!helpers.typeIsObject(strategy)) {
      throw new TypeError('strategy must be an object');
    }

    this._started = false;
    this._state = 'writable';

    this._onWrite = write;
    this._onClose = close;
    this._onAbort = abort;
    this._strategy = strategy;

    this._writablePromise = new Promise((resolve, reject) => {
      this._writablePromise_resolve = resolve;
      this._writablePromise_reject = reject;
    });

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    this._closedPromise.then(() => this._state = 'closed');

    this._queue = [];

    this._startedPromise = Promise.resolve(start(this._error.bind(this)));
    this._startedPromise.then(() => this._started = true);
    this._startedPromise.catch(r => this._error(r));
  }

  get closed() {
    return this._closedPromise;
  }

  get state() {
    return this._state;
  }

  write(chunk) {
    switch (this._state) {
      case 'waiting':
      case 'writable':
        var chunkSize = this._strategy.size(chunk);

        var resolver, rejecter;
        var promise = new Promise((resolve, reject) => {
          resolver = resolve;
          rejecter = reject;
        });

        helpers.enqueueValueWithSize(
          this._queue,
          { type: 'chunk', promise: promise, chunk: chunk, _resolve: resolver, _reject: rejecter },
          chunkSize
        );

        try {
          this._syncStateWithQueue();
        } catch (e) {
          this._error(e);
          return promise;
        }

        this._callOrScheduleAdvanceQueue();

        return promise;

      case 'closing':
        return Promise.reject(new TypeError('cannot write while stream is closing'));

      case 'closed':
        return Promise.reject(new TypeError('cannot write after stream is closed'));

      case 'errored':
        return Promise.reject(this._storedError);
    }
  }

  close() {
    switch (this._state) {
      case 'writable':
        this._writablePromise = Promise.reject(new TypeError('stream has already been closed'));
        this._writablePromise_resolve = null;
        this._writablePromise_reject = null;
        break;

      case 'waiting':
        this._writablePromise_reject(new TypeError('stream has already been closed'));
        break;

      case 'closing':
        return Promise.reject(new TypeError('cannot close an already-closing stream'));

      case 'closed':
        return Promise.reject(new TypeError('cannot close an already-closed stream'));

      case 'errored':
        return Promise.reject(this._storedError);
    }

    this._state = 'closing';
    helpers.enqueueValueWithSize(
      this._queue,
      {
        type: 'close',
        promise: this._closedPromise,
        chunk: undefined,
        _resolve: this._closedPromise_resolve,
        _reject: this._closedPromise_reject
      },
      0
    );
    this._callOrScheduleAdvanceQueue();
    return this._closedPromise;
  }

  abort(reason) {
    switch (this._state) {
      case 'closed':
        return Promise.resolve(undefined);
      case 'errored':
        return Promise.reject(this._storedError);
      default:
        this._error(reason);
        return helpers.promiseCall(this._onAbort, reason);
    }
  }

  wait() {
    return this._writablePromise;
  }

  _error(error) {
    if (this._state === 'closed' || this._state === 'errored') {
      return;
    }

    while (this._queue.length > 0) {
      var writeRecord = helpers.dequeueValue(this._queue);
      writeRecord._reject(error);
    }

    this._currentWritePromise = undefined;
    this._currentWritePromise_resolve = null;
    this._currentWritePromise_reject = null;
    this._storedError = error;
    if (this._state === 'writable' || this._state === 'closing') {
      this._writablePromise = Promise.reject(error);
      this._writablePromise_resolve = null;
      this._writablePromise_reject = null;
    } else if (this._state === 'waiting') {
      this._writablePromise_reject(error);
    }
    this._closedPromise_reject(error);
    this._state = 'errored';
  }

  _callOrScheduleAdvanceQueue() {
    if (this._started === false) {
      this._startedPromise.then(() => {
        this._advanceQueue();
      });
    }

    if (this._started === true) {
      this._advanceQueue();
    }
  }

  _advanceQueue() {
    if (this._queue.length === 0 || this._currentWritePromise !== undefined) {
      return;
    }

    var writeRecord = helpers.peekQueueValue(this._queue);

    if (writeRecord.type === 'close') {
      assert(this._state === 'closing', 'can\'t process final write record unless already closing');
      helpers.dequeueValue(this._queue);
      assert(this._queue.length === 0, 'queue must be empty once the final write record is dequeued');
      this._doClose();
    } else {
      assert(writeRecord.type === 'chunk', 'invalid write record type ' + writeRecord.type);

      this._currentWritePromise = writeRecord.promise;
      this._currentWritePromise_resolve = writeRecord._resolve;
      this._currentWritePromise_reject = writeRecord._reject;

      var signalDone = () => {
        if (this._currentWritePromise !== writeRecord.promise) {
          return;
        }
        this._currentWritePromise = undefined;
        this._currentWritePromise_resolve = null;
        this._currentWritePromise_reject = null;

        writeRecord._resolve(undefined);

        helpers.dequeueValue(this._queue);
        try {
          this._syncStateWithQueue();
        } catch (e) {
          this._error(e);
          return;
        }

        this._advanceQueue();
      };

      try {
        this._onWrite(writeRecord.chunk, signalDone, this._error.bind(this));
      } catch (error) {
        this._error(error);
      }
    }
  }

  _syncStateWithQueue() {
    if (this._state === 'closing') {
      return;
    }

    assert(
      this._state === 'writable' || this._state === 'waiting',
      'state should be writable or waiting; it is ' + this._state);

    if (this._state === 'waiting' && this._queue.length === 0) {
      this._state = 'writable';
      this._writablePromise_resolve(undefined);
      return;
    }

    var queueSize = helpers.getTotalQueueSize(this._queue);
    var needsMore = Boolean(this._strategy.needsMore(queueSize));

    if (needsMore === true && this._state === 'waiting') {
      this._state = 'writable';
      this._writablePromise_resolve(undefined);
    }

    if (needsMore === false && this._state === 'writable') {
      this._state = 'waiting';
      this._writablePromise = new Promise((resolve, reject) => {
        this._writablePromise_resolve = resolve;
        this._writablePromise_reject = reject;
      });
    }
  }

  _doClose() {
    assert(this._state === 'closing', 'stream must be in closing state to process doClose');

    var closePromise = helpers.promiseCall(this._onClose);

    closePromise.then(
      () => this._closedPromise_resolve(undefined),
      r => this._error(r)
    );
  }
}
