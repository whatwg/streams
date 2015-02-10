var assert = require('assert');
import * as helpers from '../helpers';
import ReadableStream from '../readable-stream';
import ExclusiveByteStreamReader from './exclusive-byte-stream-reader';
import { CloseReadableByteStream, CreateNotifyReadyFunction, ErrorReadableByteStream, IsReadableByteStream,
  IsReadableByteStreamLocked, ReadFromReadableByteStream, ReadIntoFromReadableByteStream
  } from './readable-byte-stream-abstract-ops';

export default class ReadableByteStream {
  constructor(underlyingByteSource = {}) {
    this._underlyingByteSource = underlyingByteSource;

    this._readableByteStreamReader = undefined;
    this._state = 'waiting';

    this._initReadyPromise();
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    helpers.InvokeOrNoop(underlyingByteSource, 'start',
                         [CreateNotifyReadyFunction(this), ErrorReadableByteStream.bind(null, this)])
  }

  get state() {
    if (!IsReadableByteStream(this)) {
      throw new TypeError('ReadableByteStream.prototype.state can only be used on a ReadableByteStream');
    }

    if (IsReadableByteStreamLocked(this)) {
      return 'waiting';
    }

    return this._state;
  }

  readInto(arrayBuffer, offset, size) {
    if (!IsReadableByteStream(this)) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.readInto can only be used on a ReadableByteStream'));
    }

    if (IsReadableByteStreamLocked(this)) {
      throw new TypeError('This stream is locked to a single exclusive reader and cannot be read from directly');
    }

    return ReadIntoFromReadableByteStream(this, arrayBuffer, offset, size);
  }

  read() {
    if (!IsReadableByteStream(this)) {
      throw new TypeError('ReadableByteStream.prototype.read can only be used on a ReadableByteStream');
    }

    if (IsReadableByteStreamLocked(this)) {
      throw new TypeError('This stream is locked to a single exclusive reader and cannot be read from directly');
    }

    return ReadFromReadableByteStream(this);
  }

  get ready() {
    if (!IsReadableByteStream(this)) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.ready can only be used on a ReadableByteStream'));
    }

    return this._readyPromise;
  }

  cancel(reason) {
    if (!IsReadableByteStream(this)) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.cancel can only be used on a ReadableByteStream'));
    }

    if (this._state === 'closed' || this._state === 'errored') {
      return this._closedPromise;
    }

    CloseReadableByteStream(this);

    var sourceCancelPromise = helpers.PromiseInvokeOrNoop(this._underlyingByteSource, 'cancel', [reason]);
    return sourceCancelPromise.then(() => undefined);
  }

  getReader() {
    if (!IsReadableByteStream(this)) {
      throw new TypeError('ReadableByteStream.prototype.getReader can only be used on a ReadableByteStream');
    }

    if (this._state === 'closed') {
      throw new TypeError('The stream has already been closed, so a reader cannot be acquired.');
    }
    if (this._state === 'errored') {
      throw this._storedError;
    }

    return new ExclusiveByteStreamReader(this);
  }

  get closed() {
    if (!IsReadableByteStream(this)) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.closed can only be used on a ReadableByteStream'));
    }

    return this._closedPromise;
  }

  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._readyPromise_resolve = resolve;
    });
  }

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

// Note: We plan to make this more efficient in the future. But for now this
// implementation suffices to show interoperability with a generic
// WritableStream.
ReadableByteStream.prototype.pipeTo = ReadableStream.prototype.pipeTo;

// These can be direct copies. Per spec though they probably should not be === since that might preclude optimizations.
ReadableByteStream.prototype.pipeThrough = ReadableStream.prototype.pipeThrough;
