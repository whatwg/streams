import { readableAcceptsReadAndCancel } from './stream-base';

export class ReadableStream {
  _initReadablePromise() {
    this._readablePromise = new Promise((resolve, reject) => {
      this._resolveReadablePromise = resolve;
    });
  }

  constructor(source) {
    this._source = source;

    this._state = 'waiting';

    this._initReadablePromise();

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });

    this._error = undefined;

    this._window = 0;

    this._reader = undefined;

    const delegate = {
      markWaiting: this._markWaiting.bind(this),
      markReadable: this._markReadable.bind(this),
      markDrained: this._markDrained.bind(this),
      markErrored: this._markErrored.bind(this)
    };

    this._source.init(delegate);
  }

  get state() {
    this._throwIfLocked();
    return this._state;
  }

  // Main interfaces.

  get readable() {
    this._throwIfLocked();
    return this._readablePromise;
  }

  _readIgnoringLock() {
    if (!readableAcceptsReadAndCancel(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    return this._source.read();
  }
  read() {
    this._throwIfLocked();
    return this._readIgnoringLock();
  }

  _cancelIgnoringLock(reason) {
    if (!readableAcceptsReadAndCancel(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    const result = this._source.cancel(reason);

    if (this._reader !== undefined) {
      this._reader._resolveErroredPromise();
    } else {
      this._resolveErroredPromise();
    }

    this._state = 'cancelled';

    return result;
  }
  cancel(reason) {
    this._throwIfLocked();
    return this._cancelIgnoringLock(reason);
  }

  // Error receiving interfaces.

  get errored() {
    this._throwIfLocked();
    return this._erroredPromise;
  }

  get _errorIgnoringLock() {
    if (this._state !== 'errored') {
      throw new TypeError('not errored');
    }
    return this._error;
  }
  get error() {
    this._throwIfLocked();
    return this._errorIgnoringLock;
  }

  // Flow control interfaces.

  get _windowIgnoringLock() {
    return this._window;
  }
  get window() {
    this._throwIfLocked();
    return this._windowIgnoringLock;
  }

  set _windowIgnoringLock(v) {
    if (!readableAcceptsReadAndCancel(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._window = v;

    this._source.onWindowUpdate(v);
  }
  set window(v) {
    this._throwIfLocked();
    this._windowIgnoringLock = v;
  }

  // Locking interfaces.

  _throwIfLocked() {
    if (this._reader !== undefined) {
      throw new TypeError('locked');
    }
  }

  getReader() {
    this._throwIfLocked();
    this._reader = new ExclusiveStreamWriter(this);
    return this._reader;
  }

  // Methods exposed only to the underlying source.

  _markWaiting() {
    if (this._reader === undefined) {
      this._initReadablePromise();
    } else {
      this._reader._initReadablePromise();
    }

    this._state = 'waiting';
  }

  _markReadable() {
    if (this._state !== 'waiting') {
      return;
    }

    if (this._reader === undefined) {
      this._resolveReadablePromise();
    } else {
      this._reader._resolveReadablePromise();
    }

    this._state = 'readable';
  }

  _markDrained() {
    this._state = 'drained';
  }

  _markErrored(error) {
    if (this._reader === undefined) {
      this._resolveErroredPromise();
    } else {
      this._writer._resolveErroredPromise();
    }

    this._state = 'errored';

    this._error = error;
  }
}

ReadableStream.EOS = {};
