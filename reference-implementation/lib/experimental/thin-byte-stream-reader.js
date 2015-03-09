import { readableAcceptsCancel } from './thin-stream-base';

export class ThinByteStreamReader {
  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReadyPromise = resolve;
    });
  }

  _initPullReadyPromise() {
    this._pullReadyPromise = new Promise((resolve, reject) => {
      this._resolvePullReadyPromise = resolve;
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

    this._pullable = false;
    this._initPullReadyPromise();

    const delegate = {
      markPullable: this._markPullable.bind(this),
      markNotPullable: this._markNotPullable.bind(this),

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

  // Manual pull interfaces.

  get pullable() {
    return this._pullable;
  }

  get pullReady() {
    return this._pullReadyPromise;
  }

  pull(view) {
    if (!this._pullable) {
      throw new TypeError('not pullable');
    }

    this._source.pull(view);
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

  _markNotPullable() {
    if (!this._pullable) {
      return;
    }

    this._initPullReadyPromise();
    this._pullable = false;
  }

  _markPullable() {
    if (this._pullable) {
      return;
    }

    this._resolvePullReadyPromise();
    this._resolvePullReadyPromise = undefined;
    this._pullable = true;
  }

  _markWaiting() {
    if (this._state === 'waiting') {
      return;
    }

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
