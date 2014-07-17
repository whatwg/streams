var assert = require('assert');
module helpers from'./helpers';
import CountQueuingStrategy from './count-queuing-strategy';

export default class ReadableStream {
  constructor({
    start = () => {},
    pull = () => {},
    cancel = () => {},
    strategy = new CountQueuingStrategy({ highWaterMark: 0 })
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
    this._waitPromise = new Promise((resolve, reject) => {
      this._waitPromise_resolve = resolve;
      this._waitPromise_reject = reject;
    });
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
          this._waitPromise = Promise.resolve(undefined);
          this._waitPromise_resolve = null;
          this._waitPromise_reject = null;
          this._closedPromise_resolve(undefined);
          this._closedPromise_resolve = null;
          this._closedPromise_reject = null;
      } else {
        this._state = 'waiting';
        this._waitPromise = new Promise((resolve, reject) => {
          this._waitPromise_resolve = resolve;
          this._waitPromise_reject = reject;
        });
        this._callPull();
      }
    }

    return chunk;
  }

  wait() {
    if (this._state === 'waiting') {
      this._callPull();
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
      this._waitPromise_resolve(undefined);
    }
    if (this._state === 'readable') {
      this._waitPromise = Promise.resolve(undefined);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;
    }

    this._queue = [];
    this._state = 'closed';
    this._closedPromise_resolve(undefined);

    return helpers.promiseCall(this._onCancel, reason);
  }

  get closed() {
    return this._closedPromise;
  }

  pipeTo(dest, { close = true } = {}) {
    var source = this;
    close = Boolean(close);

    fillDest();
    dest.closed.then(
      () => {
        if (source.state === 'readable' || source.state === 'waiting') {
          cancelSource(new TypeError('destination is closed and cannot be piped to anymore'));
        }
      },
      cancelSource
    );

    return dest;

    function fillDest() {
      if (dest.state === 'writable') {
        pumpSource();
      } else if (dest.state === 'waiting') {
        dest.wait().then(fillDest, cancelSource);
      } else if (dest.state === 'errored') {
        dest.wait().catch(cancelSource);
      } else {
        cancelSource(new TypeError('destination is closing or closed and cannot be piped to anymore'));
      }
    }

    function pumpSource() {
      if (source.state === 'readable') {
        dest.write(source.read()).catch(cancelSource);
        fillDest();
      } else if (source.state === 'waiting') {
        source.wait().then(fillDest, abortDest);
      } else if (source.state === 'closed') {
        closeDest();
      } else {
        abortDest();
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

  pipeThrough({ input, output }, options) {
    if (!helpers.typeIsObject(input)) {
      throw new TypeError('A transform stream must have an input property that is an object.');
    }

    if (!helpers.typeIsObject(output)) {
      throw new TypeError('A transform stream must have an output property that is an object.');
    }

    this.pipeTo(input, options);
    return output;
  }

  _enqueue(chunk) {
    if (this._state === 'waiting' || this._state === 'readable') {
      var chunkSize = this._strategy.size(chunk);
      helpers.enqueueValueWithSize(this._queue, chunk, chunkSize);
      this._pulling = false;
    }
    if (this._state === 'waiting') {
      this._state = 'readable';
      this._waitPromise_resolve(undefined);
      return true;
    }
    if (this._state === 'readable') {
      var queueSize = helpers.getTotalQueueSize(this._queue);
      return this._strategy.needsMore(queueSize);
    }

    return false;
  }

  _close() {
    if (this._state === 'waiting') {
      this._state = 'closed';
      this._waitPromise_resolve(undefined);
      this._closedPromise_resolve(undefined);
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
      this._closedPromise_reject(error);
    }
    else if (this._state === 'readable') {
      this._queue = [];
      this._state = 'errored';
      this._storedError = error;

      this._waitPromise = Promise.reject(error);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;
      this._closedPromise_reject(error);
    }
  }

  _callPull() {
    if (this._pulling === true) {
      return;
    }
    this._pulling = true;

    if (this._started === false) {
      this._startedPromise.then(() => {
        try {
          this._onPull(
            this._enqueue.bind(this),
            this._close.bind(this),
            this._error.bind(this)
          );
        } catch (pullResultE) {
          this._error(pullResultE);
        }
      });
    }

    if (this._started === true) {
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
  }
}
