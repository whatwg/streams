var assert = require('assert');
import { ReadFromReadableStream } from './readable-stream-abstract-ops';

export default class ExclusiveStreamReader {
  constructor(stream) {
    if (!('_readableStreamReader' in stream)) {
      throw new TypeError('ExclusiveStreamReader can only be used with ReadableStream objects or subclasses');
    }

    if (stream._readableStreamReader !== undefined) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    stream._readableStreamReader = this;

    this._stream = stream;

    this._closedAfterRelease = undefined;
    this._readyAfterRelease = undefined;
    this._stateAfterRelease = undefined;

    this._lockReleased = new Promise(resolve => {
      this._lockReleased_resolve = resolve;
    });
  }

  get ready() {
    if (this._stream._readableStreamReader !== this) {
      return this._readyAfterRelease;
    }

    return Promise.race([this._stream._readyPromise, this._lockReleased]);
  }

  get state() {
    if (this._stream._readableStreamReader !== this) {
      return this._stateAfterRelease;
    }

    return this._stream._state;
  }

  get closed() {
    if (this._stream._readableStreamReader !== this) {
      return this._closedAfterRelease;
    }

    return Promise.race([this._stream.closed, this._lockReleased]);
  }

  get isActive() {
    return this._stream._readableStreamReader === this;
  }

  read() {
    if (this._stream._readableStreamReader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    return ReadFromReadableStream(this._stream);
  }

  cancel(reason, ...args) {
    if (this._stream._readableStreamReader !== this) {
      return this._closedAfterRelease;
    }

    this.releaseLock();
    return this._stream.cancel(reason, ...args);
  }

  releaseLock() {
    if (this._stream._readableStreamReader !== this) {
      return undefined;
    }

    this._stream._readableStreamReader = undefined;

    this._stateAfterRelease = this._stream.state;
    this._readyAfterRelease = Promise.resolve(undefined);
    if (this._stateAfterRelease === 'closed' || this._stateAfterRelease === 'errored') {
      this._closedAfterRelease = this._stream.closed;
    } else {
      this._stateAfterRelease = 'closed';
      this._closedAfterRelease = Promise.resolve(undefined);
    }

    this._lockReleased_resolve(undefined);
  }
}
