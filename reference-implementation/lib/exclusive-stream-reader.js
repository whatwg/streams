var assert = require('assert');
import { AttachExclusiveStreamReader, ReadFromReadableStream, CancelReadableStream, CloseReadableStreamReader,
  DetachReadableStreamReader, IsExclusiveStreamReader } from './readable-stream-abstract-ops';

export default class ExclusiveStreamReader {
  constructor(stream) {
    if (!('_readableStreamReader' in stream)) {
      throw new TypeError('ExclusiveStreamReader can only be used with ReadableStream objects or subclasses');
    }

    if (stream._readableStreamReader !== undefined) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    AttachExclusiveStreamReader(stream, this);

    this._state = stream._state;
    if (stream._state === 'waiting') {
      this._initReadyPromise();
    } else {
      this._readyPromise = Promise.resolve(undefined);
    }
    this._initClosedPromise();

    this._encapsulatedReadableStream = stream;
  }

  get ready() {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.ready can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    return this._readyPromise;
  }

  get state() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.state can only be used on a ExclusiveStreamReader');
    }

    return this._state;
  }

  get closed() {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.closed can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    return this._closedPromise;
  }

  get isActive() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.isActive can only be used on a ExclusiveStreamReader');
    }

    return this._encapsulatedReadableStream._readableStreamReader === this;
  }

  read() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.read can only be used on a ExclusiveStreamReader');
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    // Bypass lock check.
    return ReadFromReadableStream(this._encapsulatedReadableStream);
  }

  cancel(reason, ...args) {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.cancel can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return this._closedPromise;
    }

    // Bypass lock check.
    return CancelReadableStream(this._encapsulatedReadableStream, reason, ...args);
  }

  releaseLock() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.releaseLock can only be used on a ExclusiveStreamReader');
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return undefined;
    }

    // When the stream is errored or closed, the reader is released automatically. So, here, this._state is neither
    // 'closed' nor 'errored'.
    assert(this._state === 'waiting' || this._state === 'readable');

    CloseReadableStreamReader(this);
    DetachReadableStreamReader(this._encapsulatedReadableStream);
  }

  // Utility functions

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
