var assert = require('assert');

export default class ExclusiveStreamReader {
  constructor(stream) {
    if (!('_reader' in stream)) {
      throw new TypeError('ExclusiveStreamReader can only be used with ReadableStream objects or subclasses');
    }

    if (stream._reader !== undefined) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    stream._reader = this;

    this._stream = stream;

    this._closedAfterRelease = undefined;
    this._readyAfterRelease = undefined;
    this._stateAfterRelease = undefined;

    this._lockReleased = new Promise(resolve => {
      this._lockReleased_resolve = resolve;
    });
  }

  get ready() {
    if (this._stream._reader !== this) {
      return this._readyAfterRelease;
    }

    this._stream._reader = undefined;
    try {
      return Promise.race([this._stream.ready, this._lockReleased]);
    } finally {
      this._stream._reader = this;
    }
  }

  get state() {
    if (this._stream._reader !== this) {
      return this._stateAfterRelease;
    }

    this._stream._reader = undefined;
    try {
      return this._stream.state;
    } finally {
      this._stream._reader = this;
    }
  }

  get closed() {
    if (this._stream._reader !== this) {
      return this._closedAfterRelease;
    }

    return this._stream.closed;
  }

  get isActive() {
    return this._stream._reader === this;
  }

  read(...args) {
    if (this._stream._reader !== this) {
      throw new TypeError('This stream reader has released its lock on the stream and can no longer be used');
    }

    this._stream._reader = undefined;
    try {
      return this._stream.read(...args);
    } finally {
      this._stream._reader = this;
    }
  }

  cancel(reason, ...args) {
    if (this._stream._reader !== this) {
      return this._closedAfterRelease;
    }

    this.releaseLock();
    return this._stream.cancel(reason, ...args);
  }

  releaseLock() {
    if (this._stream._reader !== this) {
      return undefined;
    }

    this._stream._reader = undefined;

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
