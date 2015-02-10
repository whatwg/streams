var assert = require('assert');
import * as helpers from '../helpers';
import ReadableStream from '../readable-stream';
import ExclusiveByteStreamReader from './exclusive-byte-stream-reader';
import { ErrorReadableByteStream, IsReadableByteStream, IsReadableByteStreamLocked, ReadFromReadableByteStream
  } from './readable-byte-stream-abstract-ops';

// TODO: convert these to abstract ops that vend functions, instead of functions that we `.bind`.
function notifyReady(stream) {
  if (stream._state !== 'waiting') {
    return;
  }

  stream._state = 'readable';
  stream._resolveReadyPromise(undefined);
}

export default class ReadableByteStream {
  constructor(underlyingByteSource = {}) {
    this._underlyingByteSource = underlyingByteSource;

    this._readableByteStreamReader = undefined;
    this._state = 'waiting';

    this._readyPromise = new Promise((resolve, reject) => {
      this._readyPromise_resolve = resolve;
      this._readyPromise_reject = reject;
    });
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    helpers.InvokeOrNoop(underlyingByteSource, 'start',
                         [notifyReady.bind(null, this), ErrorReadableByteStream.bind(null, this)])
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
          new TypeError('ReadableByteStream.prototype.ready can only be used on a ReadableByteStream'));
    }

    if (this._state === 'waiting') {
      throw new TypeError('not ready for read');
    }
    if (this._state === 'closed') {
      throw new TypeError('stream has already been consumed');
    }
    if (this._state === 'errored') {
      throw this._storedError;
    }

    assert(this._state === 'readable');

    if (offset === undefined) {
      offset = 0;
    } else {
      offset = helpers.toInteger(offset);

      if (offset < 0) {
        throw new RangeError('offset must be non-negative');
      }
    }

    if (size === undefined) {
      size = arrayBuffer.byteLength - offset;
    } else {
      size = helpers.toInteger(size);
    }

    if (size < 0) {
      throw new RangeError('size must be non-negative');
    }
    if (offset + size > arrayBuffer.byteLength) {
      throw new RangeError('the specified range is out of bounds for arrayBuffer');
    }

    var bytesRead;
    try {
      var readInto = this._underlyingByteSource['readInto'];
      if (readInto === undefined) {
        throw new TypeError('readInto is not defiend on the underlying byte source');
      }
      bytesRead = readInto.call(this._underlyingByteSource, arrayBuffer, offset, size);
    } catch (error) {
      ErrorReadableByteStream(this, error);
      throw error;
    }

    bytesRead = Number(bytesRead);

    if (isNaN(bytesRead) || bytesRead < -2 || bytesRead > size) {
      var error = new RangeError('readInto of underlying source returned invalid value');
      ErrorReadableByteStream(this, error);
      throw error;
    }

    if (bytesRead === -1) {
      this._state = 'closed';
      this._resolveClosedPromise(undefined);

      // Let the user investigate state again.
      return 0;
    }

    if (bytesRead === -2) {
      this._state = 'waiting';
      this._readyPromise = new Promise((resolve, reject) => {
        this._readyPromise_resolve = resolve;
        this._readyPromise_reject = reject;
      });

      return 0;
    }

    return bytesRead;
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

    if (IsReadableByteStreamLocked(this)) {
      return this._readableByteStreamReader._lockReleased.then(() => this._readyPromise);
    }

    return this._readyPromise.then(() => this._readableByteStreamReader === undefined ? undefined : this._readableByteStreamReader._lockReleased);
  }

  cancel(reason) {
    if (!IsReadableByteStream(this)) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.cancel can only be used on a ReadableByteStream'));
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

    this._state = 'closed';
    this._readableByteStreamReader = undefined;
    this._resolveClosedPromise(undefined);

    return new Promise((resolve, reject) => {
      var sourceCancelPromise = helpers.PromiseInvokeOrNoop(this._underlyingByteSource, 'cancel', [reason]);
      sourceCancelPromise.then(
        () => {
          resolve(undefined);
        },
        r => {
          reject(r);
        }
      );
    });
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

    if (IsReadableByteStreamLocked(this)) {
      return this._readableByteStreamReader._lockReleased.then(() => this._closedPromise);
    }

    return this._closedPromise;
  }

  _resolveReadyPromise(value) {
    this._readyPromise_resolve(value);
    this._readyPromise_resolve = null;
    this._readyPromise_reject = null;
  }

  _resolveClosedPromise(value) {
    this._closedPromise_resolve(value);
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
