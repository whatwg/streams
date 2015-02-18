const assert = require('assert');
import * as helpers from './helpers';
import { AcquireExclusiveStreamReader, CallReadableStreamPull, CancelReadableStream, CreateReadableStreamCloseFunction,
  CreateReadableStreamEnqueueFunction, CreateReadableStreamErrorFunction, IsReadableStream, ReadableStreamEOS,
  ReadFromReadableStream, ShouldReadableStreamApplyBackpressure } from './readable-stream-abstract-ops';

export default class ReadableStream {
  constructor(underlyingSource = {}) {
    this._underlyingSource = underlyingSource;
    this._initReadyPromise();
    this._initClosedPromise();
    this._queue = [];
    this._state = 'readable';
    this._started = false;
    this._draining = false;
    this._reading = false;
    this._pullScheduled = false;
    this._pullingPromise = undefined;
    this._readableStreamReader = undefined;

    this._enqueue = CreateReadableStreamEnqueueFunction(this);
    this._close = CreateReadableStreamCloseFunction(this);
    this._error = CreateReadableStreamErrorFunction(this);

    const startResult = helpers.InvokeOrNoop(underlyingSource, 'start', [this._enqueue, this._close, this._error]);
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

    return this._state;
  }

  cancel(reason) {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.cancel can only be used on a ReadableStream'));
    }

    return CancelReadableStream(this, reason);
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

    const source = this;
    const EOS = source.constructor.EOS;
    let closedPurposefully = false;
    let resolvePipeToPromise;
    let rejectPipeToPromise;

    return new Promise((resolve, reject) => {
      resolvePipeToPromise = resolve;
      rejectPipeToPromise = reject;

      source.closed.catch(abortDest);
      dest.closed.then(
        () => {
          if (!closedPurposefully) {
            cancelSource(new TypeError('destination is closing or closed and cannot be piped to anymore'));
          }
        },
        cancelSource
      );

      doPipe();
    });

    function doPipe() {
      Promise.all([source.read(), dest.ready]).then(([chunk]) => {
        if (chunk === EOS) {
          closeDest();
        } else {
          dest.write(chunk);
          doPipe();
        }
      });

      // Any failures will be handled by listening to source.closed and dest.closed above.
      // TODO: handle malicious dest.write/dest.close?
    }

    function cancelSource(reason) {
      const sourceState = source.state;
      if (preventCancel === false && sourceState === 'readable') {
        source.cancel(reason);
      }
      rejectPipeToPromise(reason);
    }

    function closeDest() {
      const destState = dest.state;
      if (preventClose === false && (destState === 'waiting' || destState === 'writable')) {
        closedPurposefully = true;
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
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.read can only be used on a ReadableStream'));
    }

    if (this._reading) {
      return Promise.reject(new TypeError('A concurrent read is already in progress for this stream'));
    }

    return ReadFromReadableStream(this);
  }


  _initReadyPromise() {
    this._readyPromise = new Promise((resolve) => {
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

Object.defineProperty(ReadableStream, 'EOS', {
  value: ReadableStreamEOS,
  enumerable: false,
  configurable: false,
  writable: false
});
