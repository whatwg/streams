var assert = require('assert');
import {
  IsExclusiveStreamReader,
  PutBackIntoReadableStream,
  ReadFromReadableStream
} from './readable-stream-abstract-ops';

export default class ExclusiveStreamReader {
  constructor(stream) {
    if (!('_readableStreamReader' in stream)) {
      throw new TypeError('ExclusiveStreamReader can only be used with ReadableStream objects or subclasses');
    }

    if (stream._readableStreamReader !== undefined) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    stream._readableStreamReader = this;

    this._encapsulatedReadableStream = stream;

    this._closedAfterRelease = undefined;
    this._readyAfterRelease = undefined;
    this._stateAfterRelease = undefined;

    this._lockReleased = new Promise(resolve => {
      this._lockReleased_resolve = resolve;
    });
  }

  get ready() {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.ready can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return this._readyAfterRelease;
    }

    return Promise.race([this._encapsulatedReadableStream._readyPromise, this._lockReleased]);
  }

  get state() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.state can only be used on a ExclusiveStreamReader');
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return this._stateAfterRelease;
    }

    return this._encapsulatedReadableStream._state;
  }

  get closed() {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.closed can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return this._closedAfterRelease;
    }

    return Promise.race([this._encapsulatedReadableStream._closedPromise, this._lockReleased]);
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

    return ReadFromReadableStream(this._encapsulatedReadableStream);
  }

  putBack(chunk) {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.putBack can only be used on a ExclusiveStreamReader');
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    return PutBackIntoReadableStream(this._encapsulatedReadableStream, chunk);
  }

  cancel(reason, ...args) {
    if (!IsExclusiveStreamReader(this)) {
      return Promise.reject(new TypeError('ExclusiveStreamReader.prototype.cancel can only be used on a ' +
        'ExclusiveStreamReader'));
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return this._closedAfterRelease;
    }

    this.releaseLock();
    return this._encapsulatedReadableStream.cancel(reason, ...args);
  }

  releaseLock() {
    if (!IsExclusiveStreamReader(this)) {
      throw new TypeError('ExclusiveStreamReader.prototype.releaseLock can only be used on a ExclusiveStreamReader');
    }

    if (this._encapsulatedReadableStream._readableStreamReader !== this) {
      return undefined;
    }

    this._encapsulatedReadableStream._readableStreamReader = undefined;

    this._stateAfterRelease = this._encapsulatedReadableStream.state;
    this._readyAfterRelease = Promise.resolve(undefined);
    if (this._stateAfterRelease === 'closed' || this._stateAfterRelease === 'errored') {
      this._closedAfterRelease = this._encapsulatedReadableStream.closed;
    } else {
      this._stateAfterRelease = 'closed';
      this._closedAfterRelease = Promise.resolve(undefined);
    }

    this._lockReleased_resolve(undefined);
  }
}
