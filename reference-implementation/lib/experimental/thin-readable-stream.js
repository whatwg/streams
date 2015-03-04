import { readableAcceptsCancel } from './new-stream-base';

export class NewReadableStream {
  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReadyPromise = resolve;
    });
  }

  constructor(source) {
    this._source = source;

    this._state = 'waiting';

    this._initReadyPromise();

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });
    this._error = undefined;

    this._window = 0;

    const delegate = {
      markWaiting: this._markWaiting.bind(this),
      markReadable: this._markReadable.bind(this),
      markClosed: this._markClosed.bind(this),

      markErrored: this._markErrored.bind(this)
    };

    this._source.start(delegate);
  }

  get state() {
    return this._state;
  }

  // Auto pull interfaces.

  get window() {
    return this._window;
  }

  set window(v) {
    if (!readableAcceptsCancel(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._window = v;

    this._source.onWindowUpdate(v);
  }

  // Reading interfaces.

  get ready() {
    return this._readyPromise;
  }

  read() {
    if (this._state !== 'readable') {
      throw new TypeError('not readable');
    }

    return this._source.read();
  }

  cancel(reason) {
    if (!readableAcceptsCancel(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    this._source.cancel(reason);

    this._state = 'cancelled';
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

  // Methods exposed only to the underlying source.

  _markWaiting() {
    this._initReadyPromise();
    this._state = 'waiting';
  }

  _markReadable() {
    if (this._state === 'readable') {
      return;
    }

    this._resolveReadyPromise();
    this._resolveReadyPromise = undefined;
    this._state = 'readable';
  }

  _markClosed() {
    if (this._state !== 'readable') {
      this._resolveReadyPromise();
      this._resolveReadyPromise = undefined;
    }
    this._state = 'closed';
  }

  _markErrored(error) {
    this._resolveErroredPromise();
    this._resolveErroredPromise = undefined;
    this._state = 'errored';
    this._error = error;
  }
}
