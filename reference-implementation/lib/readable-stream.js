var assert = require('assert');
import * as helpers from'./helpers';
import CountQueuingStrategy from './count-queuing-strategy';

export default class ReadableStream {
  constructor({
    start = () => {},
    pull = () => {},
    cancel = () => {},
    strategy = new CountQueuingStrategy({ highWaterMark: 1 })
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
    if (!helpers.typeIsObject(strategy)) {
      throw new TypeError('strategy must be an object');
    }

    this._started = false;
    this._draining = false;
    this._pulling = false;
    this._state = 'waiting';

    this._onCancel = cancel;
    this._onPull = pull;
    this._strategy = strategy;
    this._initWaitPromise();

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    this._queue = [];

    this._startedPromise = Promise.resolve(
      start(
        this._enqueue.bind(this),
        this._close.bind(this),
        this._error.bind(this)
      )
    );

    this._startedPromise.then(() => this._started = true);
    this._startedPromise.catch(r => this._error(r));
  }

  get state() {
    return this._state;
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

    var chunk = helpers.dequeueValue(this._queue);

    if (this._queue.length < 1) {
      if (this._draining === true) {
        this._state = 'closed';
        this._resolveClosedPromise(undefined);
      } else {
        this._state = 'waiting';
        this._initWaitPromise();
        this._callOrSchedulePull();
      }
    }

    return chunk;
  }

  wait() {
    if (this._state === 'waiting') {
      this._callOrSchedulePull();
    }

    return this._waitPromise;
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

    return helpers.promiseCall(this._onCancel, reason);
  }

  get closed() {
    return this._closedPromise;
  }

  pipeTo(dest, { close = true } = {}) {
    var source = this;
    close = Boolean(close);

    doPipe();
    return dest;

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
        } else if (ds === 'errored' &&
            (source.state === 'readable' || source.state === 'waiting')) {
          dest.wait().catch(cancelSource);
        } else if ((ds === 'closing' || ds === 'closed') &&
            (source.state === 'readable' || source.state === 'waiting')) {
          cancelSource(new TypeError(
              'destination is closing or closed and cannot be piped to anymore'));
        }
        return;
      }
    }

    function cancelSource(reason) {
      source.cancel(reason);
    }

    function closeDest() {
      if (close) {
        dest.close();
      }
    }

    function abortDest(reason) {
      // ISSUE: should this be preventable via an option or via `options.close`?
      dest.abort(reason);
    }
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

  _enqueue(chunk) {
    if (this._state === 'errored' || this._state === 'closed') {
      return false;
    }

    if (this._draining === true) {
      throw new TypeError('stream has already been closed');
    }

    var chunkSize;
    try {
      chunkSize = this._strategy.size(chunk);
    } catch (error) {
      this._error(error);
      return false;
    }

    helpers.enqueueValueWithSize(this._queue, chunk, chunkSize);
    this._pulling = false;

    var queueSize = helpers.getTotalQueueSize(this._queue);
    var shouldApplyBackpressure;
    try {
      shouldApplyBackpressure = Boolean(this._strategy.shouldApplyBackpressure(queueSize));
    } catch (error) {
      this._error(error);
      return false;
    }

    if (this._state === 'waiting') {
      this._state = 'readable';
      this._resolveWaitPromise(undefined);
    }

    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  }

  _close() {
    if (this._state === 'waiting') {
      this._state = 'closed';
      this._resolveWaitPromise(undefined);
      this._resolveClosedPromise(undefined);
    }
    else if (this._state === 'readable') {
      this._draining = true;
    }
  }

  _error(error) {
    if (this._state === 'waiting') {
      this._state = 'errored';
      this._storedError = error;

      this._waitPromise_reject(error);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;

      this._rejectClosedPromise(error);
    }
    else if (this._state === 'readable') {
      this._queue = [];
      this._state = 'errored';
      this._storedError = error;

      this._waitPromise = Promise.reject(error);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;

      this._rejectClosedPromise(error);
    }
  }

  _callOrSchedulePull() {
    if (this._pulling === true) {
      return;
    }
    this._pulling = true;

    if (this._started === false) {
      this._startedPromise.then(() => {
        this._callPull();
      });
    }

    if (this._started === true) {
      this._callPull();
    }
  }

  _callPull() {
    try {
      this._onPull(
        this._enqueue.bind(this),
        this._close.bind(this),
        this._error.bind(this)
      );
    } catch (pullResultE) {
      this._error(pullResultE);
    }
  }

  _initWaitPromise() {
    this._waitPromise = new Promise((resolve, reject) => {
      this._waitPromise_resolve = resolve;
      this._waitPromise_reject = reject;
    });
  }

  _resolveWaitPromise(value) {
    this._waitPromise_resolve(value);
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
