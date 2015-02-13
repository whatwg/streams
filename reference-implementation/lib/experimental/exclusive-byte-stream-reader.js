const assert = require('assert');
import { CancelReadableByteStream, CloseReadableByteStreamReader, IsReadableByteStreamLocked,
  IsExclusiveByteStreamReader, ReadFromReadableByteStream, ReadIntoFromReadableByteStream
  } from './readable-byte-stream-abstract-ops';

export default class ExclusiveByteStreamReader {
  constructor(stream) {
    if (!('_readableByteStreamReader' in stream)) {
      throw new TypeError('ExclusiveByteStreamReader can only be used with ReadableByteStream objects or subclasses');
    }

    if (IsReadableByteStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    // Update the states of the encapsulated stream to represent a locked stream.
    if (stream._state === 'readable') {
      stream._initReadyPromise();
    }
    stream._readableByteStreamReader = this;

    // Sync the states of this reader with the encapsulated stream.
    this._state = stream._state;
    if (stream._state === 'waiting') {
      this._initReadyPromise();
    } else {
      this._readyPromise = Promise.resolve(undefined);
    }
    this._initClosedPromise();

    this._encapsulatedReadableByteStream = stream;
  }

  get ready() {
    if (!IsExclusiveByteStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveByteStreamReader.prototype.ready can only be used on a ' +
        'ExclusiveByteStreamReader'));
    }

    return this._readyPromise;
  }

  get state() {
    if (!IsExclusiveByteStreamReader(this)) {
      throw new TypeError('ExclusiveByteStreamReader.prototype.state can only be used on a ExclusiveByteStreamReader');
    }

    return this._state;
  }

  get closed() {
    if (!IsExclusiveByteStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveByteStreamReader.prototype.closed can only be used on a ' +
        'ExclusiveByteStreamReader'));
    }

    return this._closedPromise;
  }

  get isActive() {
    if (!IsExclusiveByteStreamReader(this)) {
      throw new TypeError('ExclusiveByteStreamReader.prototype.isActive can only be used on a ' +
        'ExclusiveByteStreamReader');
    }

    return this._encapsulatedReadableByteStream._readableByteStreamReader === this;
  }

  read() {
    if (!IsExclusiveByteStreamReader(this)) {
      throw new TypeError('ExclusiveByteStreamReader.prototype.read can only be used on a ExclusiveByteStreamReader');
    }

    if (this._encapsulatedReadableByteStream._readableByteStreamReader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    return ReadFromReadableByteStream(this._encapsulatedReadableByteStream);
  }

  readInto(arrayBuffer, offset, size) {
    if (!IsExclusiveByteStreamReader(this)) {
      throw new TypeError(
          'ExclusiveByteStreamReader.prototype.readInto can only be used on a ExclusiveByteStreamReader');
    }

    if (this._encapsulatedReadableByteStream._readableByteStreamReader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    return ReadIntoFromReadableByteStream(this._encapsulatedReadableByteStream, arrayBuffer, offset, size);
  }

  cancel(reason) {
    if (!IsExclusiveByteStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveByteStreamReader.prototype.cancel can only be used on a ' +
        'ExclusiveByteStreamReader'));
    }

    if (this._encapsulatedReadableByteStream._readableByteStreamReader !== this) {
      return this._closedPromise;
    }

    return CancelReadableByteStream(this._encapsulatedReadableByteStream, reason);
  }

  releaseLock() {
    if (!IsExclusiveByteStreamReader(this)) {
      throw new TypeError('ExclusiveByteStreamReader.prototype.releaseLock can only be used on a ' +
        'ExclusiveByteStreamReader');
    }

    if (this._encapsulatedReadableByteStream._readableByteStreamReader !== this) {
      return undefined;
    }

    assert(this._state === 'waiting' || this._state === 'readable');

    CloseReadableByteStreamReader(this);

    if (this._encapsulatedReadableByteStream._state === 'readable') {
      this._encapsulatedReadableByteStream._resolveReadyPromise(undefined);
    }
    this._encapsulatedReadableByteStream._readableStreamReader = undefined;
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
