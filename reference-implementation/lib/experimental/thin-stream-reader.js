import { readableAcceptsCancel } from './thin-stream-base';

export class ThinStreamReader {
  _initReadyPromise() {
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReadyPromise = resolve;
    });
  }

  constructor(source) {
    this._source = source;

    this._state = 'waiting';

    this._initReadyPromise();

    this._closedPromise = new Promise((resolve, reject) => {
      this._resolveClosedPromise = resolve;
      this._rejectClosedPromise = reject;
    });

    this._window = 0;

    this._waitingID = {};

    this._source.start(
        this._markReadable.bind(this, this._waitingID),
        this._markClosed.bind(this, this._waitingID),
        this._markErrored.bind(this));
  }

  get state() {
    return this._state;
  }

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

  get ready() {
    return this._readyPromise;
  }

  read() {
    if (this._state !== 'readable') {
      throw new TypeError('not readable');
    }

    this._waitingID = {};

    try {
      const result = this._source.read(
          this._markReadable.bind(this, this._waitingID),
          this._markClosed.bind(this, this._waitingID));

      if (this._waitingID !== undefined) {
        this._initReadyPromise();
        this._state = 'waiting';
      }

      return result;
    } catch (e) {
      const error = new TypeError('underlying source is broken: ' + e);
      this._markErrored(error);
      throw error;
    }
  }

  cancel(reason) {
    if (!readableAcceptsCancel(this._state)) {
      return Promise.reject(new TypeError('already ' + this._state));
    }

    if (this._waitingID !== undefined) {
      this._waitingID = undefined;

      this._resolveReadyPromise();
      this._resolveReadyPromise = undefined;
    }

    this._resolveClosedPromise();
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;

    this._state = 'closed';

    return this._source.cancel(reason);
  }

  get closed() {
    return this._closedPromise;
  }

  _markReadable(waitingID) {
    if (this._waitingID !== waitingID) {
      throw new TypeError('this callback is already expired');
    }
    this._waitingID = undefined;

    if (this._state === 'waiting') {
      this._resolveReadyPromise();
      this._resolveReadyPromise = undefined;
    }

    this._state = 'readable';
  }

  _markClosed(waitingID) {
    if (this._waitingID !== waitingID) {
      throw new TypeError('this callback is already expired');
    }
    this._waitingID = undefined;

    if (this._state === 'waiting') {
      this._resolveReadyPromise();
      this._resolveReadyPromise = undefined;
    }

    this._resolveClosedPromise();
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;

    this._state = 'closed';
  }

  _markErrored(error) {
    if (this._state === 'closed') {
      throw new TypeError('already closed');
    }
    if (this._state === 'errored') {
      throw new TypeError('already errored');
    }

    if (this._waitingID !== undefined) {
      this._waitingID = undefined;

      this._resolveReadyPromise();
      this._resolveReadyPromise = undefined;
    }

    this._rejectClosedPromise(error);
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;

    this._state = 'errored';
  }
}
