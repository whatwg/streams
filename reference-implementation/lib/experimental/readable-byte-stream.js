var assert = require('assert');
import * as helpers from '../helpers';

function notifyReady(stream) {
  if (stream._state !== 'waiting') {
    return;
  }

  stream._state = 'readable';
  stream._resolveWaitPromise(undefined);
}

function errorReadableByteStream(stream, error) {
  if (stream._state === 'errored' || stream._state === 'closed') {
    return;
  }

  if (stream._state === 'waiting') {
    stream._waitPromise_reject(error);
    stream._waitPromise_resolve = null;
    stream._waitPromise_reject = null;
  } else {
    stream._waitPromise = Promise.reject(error);
    stream._waitPromise_resolve = null;
    stream._waitPromise_reject = null;
  }

  stream._state = 'errored';
  stream._storedError = error;

  stream._closedPromise_reject(error);
  stream._closedPromise_resolve = null;
  stream._closedPromise_reject = null;
}

export default class ReadableByteStream {
  constructor({
    start = () => {},
    readInto = () => {},
    cancel = () => {},
    readBufferSize = undefined,
  } = {}) {
    if (typeof start !== 'function') {
      throw new TypeError('start must be a function or undefined');
    }
    if (typeof readInto !== 'function') {
      throw new TypeError('readInto must be a function or undefined');
    }
    if (typeof cancel !== 'function') {
      throw new TypeError('cancel must be a function or undefined');
    }
    if (readBufferSize !== undefined) {
      readBufferSize = helpers.toInteger(readBufferSize);
      if (readBufferSize < 0) {
        throw new RangeError('readBufferSize must be non-negative');
      }
    }

    this._state = 'waiting';

    this._onReadInto = readInto;
    this._onCancel = cancel;

    this._readBufferSize = readBufferSize;

    this._waitPromise = new Promise((resolve, reject) => {
      this._waitPromise_resolve = resolve;
      this._waitPromise_reject = reject;
    });
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    start(
      notifyReady.bind(null, this),
      errorReadableByteStream.bind(null, this)
    );
  }

  get state() {
    return this._state;
  }

  readInto(arrayBuffer, offset, size) {
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
      bytesRead = this._onReadInto.call(undefined, arrayBuffer, offset, size);
    } catch (error) {
      errorReadableByteStream(this, error);
      throw error;
    }

    bytesRead = Number(bytesRead);

    if (isNaN(bytesRead) || bytesRead < -2 || bytesRead > size) {
      var error = new RangeError('readInto of underlying source returned invalid value');
      errorReadableByteStream(this, error);
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
      this._waitPromise = new Promise((resolve, reject) => {
        this._waitPromise_resolve = resolve;
        this._waitPromise_reject = reject;
      });

      return 0;
    }

    return bytesRead;
  }

  read() {
    if (this._readBufferSize === undefined) {
      throw new TypeError('readBufferSize is not configured');
    }

    var arrayBuffer = new ArrayBuffer(this._readBufferSize);
    var bytesRead = this.readInto(arrayBuffer, 0, this._readBufferSize);
    // This code should be updated to use ArrayBuffer.prototype.transfer when
    // it's ready.
    var resizedArrayBuffer = arrayBuffer.slice(0, bytesRead);
    return resizedArrayBuffer;
  }

  get wait() {
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

    this._state = 'closed';
    this._resolveClosedPromise(undefined);

    return new Promise((resolve, reject) => {
      var sourceCancelPromise = helpers.promiseCall(this._onCancel, reason);
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

  get closed() {
    return this._closedPromise;
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
}
