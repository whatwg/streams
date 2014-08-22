var assert = require('assert');
import * as helpers from '../helpers';

export default class ReadableByteStream {
  constructor({
    start = () => {},
    readInto = () => {},
    cancel = () => {}
  } = {}) {
    if (typeof start !== 'function') {
      throw new TypeError();
    }
    if (typeof readInto !== 'function') {
      throw new TypeError();
    }
    if (typeof cancel !== 'function') {
      throw new TypeError();
    }

    this._state = 'waiting';

    this._onReadInto = readInto;
    this._onCancel = cancel;

    this._waitPromise = new Promise((resolve, reject) => {
      this._waitPromise_resolve = resolve;
      this._waitPromise_reject = reject;
    });
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    start(
      this._notifyReady.bind(this),
      this._error.bind(this)
    );
  }

  get state() {
    return this._state;
  }

  readInto(arraybuffer, offset, size) {
    if (this._state === 'waiting') {
      throw new TypeError();
    }
    if (this._state === 'closed') {
      throw new TypeError();
    }
    if (this._state === 'errored') {
      throw this._storedError;
    }

    assert(this._state === 'readable');

    if (offset === undefined) {
      offset = 0;
    } else {
      offset = helpers.toInteger(offset);

      if (offset < 0) {
        throw new TypeError();
      }
    }

    if (size === undefined) {
      size = arraybuffer.byteLength - offset;
    } else {
      size = helpers.toInteger(size);
    }

    if (size < 0 || offset + size > arraybuffer.byteLength) {
      throw new TypeError();
    }

    var bytesRead;
    try {
      bytesRead = this._onReadInto.call(undefined, arraybuffer, offset, size);
    } catch (error) {
      this._error(error);
      throw error;
    }

    bytesRead = Number(bytesRead);

    if (bytesRead < -2 || bytesRead > size) {
      var error = new TypeError();
      this._error(error);
      throw error;
    }

    if (bytesRead === -1) {
      this._state = 'closed';
      this._closedPromise_resolve(undefined);
      this._closedPromise_resolve = null;
      this._closedPromise_reject = null;

      // Let the user investigate state again.
      return 0;
    }

    if (bytesRead === -2) {
      this._state = 'waiting';
      this._waitPromise = new Promise((resolve, reject) => {
        this._waitPromise_resolve = resolve;
        this._waitPromise_reject = reject;
      });

      return 0;
    }

    return bytesRead;
  }

  get wait() {
    return this._waitPromise;
  }

  cancel(reason) {
    throw new TypeError('Not implemented');
  }

  get closed() {
    return this._closedPromise;
  }

  _notifyReady() {
    if (this._state !== 'waiting') {
      return;
    }

    this._state = 'readable';
    this._waitPromise_resolve(undefined);
    this._waitPromise_resolve = null;
    this._waitPromise_reject = null;
  }

  _error(error) {
    if (this._state === 'errored' || this._state === 'closed') {
      return;
    }

    if (this._state === 'waiting') {
      this._waitPromise_reject(error);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;
    } else {
      this._waitPromise = Promise.reject(error);
      this._waitPromise_resolve = null;
      this._waitPromise_reject = null;
    }

    this._state = 'errored';
    this._storedError = error;

    this._closedPromise_reject(error);
    this._closedPromise_resolve = null;
    this._closedPromise_reject = null;
  }
}
