var assert = require('assert');
import * as helpers from './helpers';
import { AcquireExclusiveStreamReader, CallReadableStreamPull, CloseReadableStream, CreateReadableStreamCloseFunction,
  CreateReadableStreamEnqueueFunction, CreateReadableStreamErrorFunction, IsReadableStream, PutBackIntoReadableStream,
  ReadFromReadableStream, ShouldReadableStreamApplyBackpressure } from './readable-stream-abstract-ops';

export default class ReadableStream {
  constructor(underlyingSource = {}) {
    this._underlyingSource = underlyingSource;
    this._initReadyPromise();
    this._initClosedPromise();
    this._queue = [];
    this._state = 'waiting';
    this._started = false;
    this._draining = false;
    this._pulling = false;
    this._readableStreamReader = undefined;

    this._enqueue = CreateReadableStreamEnqueueFunction(this);
    this._close = CreateReadableStreamCloseFunction(this);
    this._error = CreateReadableStreamErrorFunction(this);

    var startResult = helpers.InvokeOrNoop(underlyingSource, 'start', [this._enqueue, this._close, this._error]);
    Promise.resolve(startResult).then(
      () => {
        this._started = true;
        CallReadableStreamPull(this);
      },
      r => this._error(r)
    );
  }

  get closed() {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.closed can only be used on a ReadableStream'));
    }
    return this._closedPromise;
  }

  get state() {
    if (!IsReadableStream(this)) {
      throw new TypeError('ReadableStream.prototype.state can only be used on a ReadableStream');
    }

    if (this._readableStreamReader !== undefined) {
      return 'waiting';
    }

    return this._state;
  }

  cancel(reason) {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.cancel can only be used on a ReadableStream'));
    }

    if (this._readableStreamReader !== undefined) {
      return Promise.reject(
        new TypeError('This stream is locked to a single exclusive reader and cannot be cancelled directly'));
    }

    if (this._state === 'closed' || this._state === 'errored') {
      return this._closedPromise;
    }
    if (this._state === 'waiting') {
      this._resolveReadyPromise(undefined);
    }

    this._queue = [];
    CloseReadableStream(this);

    var sourceCancelPromise = helpers.PromiseInvokeOrNoop(this._underlyingSource, 'cancel', [reason]);
    return sourceCancelPromise.then(() => undefined);
  }

  getReader() {
    if (!IsReadableStream(this)) {
      throw new TypeError('ReadableStream.prototype.getReader can only be used on a ReadableStream');
    }

    return AcquireExclusiveStreamReader(this);
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
    if (!IsReadableStream(this)) {
      throw new TypeError('ReadableStream.prototype.read can only be used on a ReadableStream');
    }

    if (this._readableStreamReader !== undefined) {
      throw new TypeError('This stream is locked to a single exclusive reader and cannot be read from directly');
    }

    return ReadFromReadableStream(this);
  }

  putBack(chunk) {
    if (!IsReadableStream(this)) {
      throw new TypeError('ReadableStream.prototype.read can only be used on a ReadableStream');
    }

    if (this._readableStreamReader !== undefined) {
      throw new TypeError('This stream is locked to a single exclusive reader and putBack cannot be used directly');
    }

    return PutBackIntoReadableStream(this, chunk);
  }

  get ready() {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.ready can only be used on a ReadableStream'));
    }

    if (this._readableStreamReader !== undefined) {
      return this._readableStreamReader._lockReleased.then(() => this.ready);
    }

    if (this._state === 'waiting') {
      return this._readyPromise.then(() => this.ready);
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
