import { writableAcceptsWriteAndClose, writableAcceptsAbort } from './thin-stream-base';

export class ThinWritableStream {
  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReadyPromise = resolve;
    });
  }

  constructor(sink) {
    this._sink = sink;

    this._state = 'waiting';

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });
    this._error = undefined;

    this._initReadyPromise();
    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;

    const delegate = {
      markWaiting: this._markWaiting.bind(this),
      markWritable: this._markWritable.bind(this),
      onSpaceChange: this._onSpaceChange.bind(this),

      markErrored: this._markErrored.bind(this)
    };

    this._sink.start(delegate);
  }

  get state() {
    return this._state;
  }

  // Main interfaces.

  waitSpaceChange() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    if (this._spaceChangePromise !== undefined) {
      return this._spaceChangePromise;
    }

    this._spaceChangePromise = new Promise((resolve, reject) => {
      this._resolveSpaceChangePromise = resolve;
    });
    this._lastSpace = this.space;

    return this._spaceChangePromise;
  }

  write(value) {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._sink.write(value);
  }

  close() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._sink.close();

    this._state = 'closed';
  }

  abort(reason) {
    if (!writableAcceptsAbort(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._sink.abort(reason);

    this._state = 'aborted';
  }

  // Error receiving interfaces.

  get errored() {
    return this._erroredPromise;
  }

  get error() {
    if (this._state !== 'errored') {
      throw new TypeError('not errored');
    }

    return this._error;
  }

  // Flow control interfaces.

  get ready() {
    return this._readyPromise;
  }

  get space() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    return this._sink.space;
  }

  // Methods exposed only to the underlying sink.

  _markWaiting() {
    if (this._state === 'waiting') {
      return;
    }

    this._initReadyPromise();
    this._state = 'waiting';
  }

  _markWritable() {
    if (this._state === 'writable') {
      return;
    }

    this._resolveReadyPromise();
    this._resolveReadyPromise = undefined;
    this._state = 'writable';
  }

  _markErrored(error) {
    this._resolveErroredPromise();
    this._resolveErroredPromise = undefined;
    this._state = 'errored';
    this._error = error;
  }

  _onSpaceChange() {
    if (this._spaceChangePromise === undefined || this._lastSpace == this.space) {
      return;
    }

    this._resolveSpaceChangePromise();
    this._resolveSpaceChangePromise = undefined;

    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;
  }
}
