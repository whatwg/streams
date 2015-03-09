export class ThinByobByteStreamReader {
  constructor(source) {
    this._source = source;

    this._pendingReadRequests = [];
    this._cancelled = false;

    this._errored = false;
    this._errorReason = undefined;
    this._closed = false;

    this._closedPromise = new Promise((resolve, reject) => {
      this._resolveClosedPromise = resolve;
      this._rejectClosedPromise = reject;
    });

    const delegate = {
      fulfill: this._fulfill.bind(this),
      close: this._close.bind(this),
      error: this._error.bind(this)
    };

    this._source.start(delegate);
  }

  get closed() {
    return this._closedPromise;
  }

  read(container) {
    // TODO: Detach container

    if (this._cancelled) {
      return Promise.reject({value: new TypeError('already cancelled'), container});
    }

    if (this._errored) {
      return Promise.reject({value: this._errorReason, container});
    }
    if (this._closed) {
      return Promise.resolve({done: true, container});
    }

    return new Promise((resolve, reject) => {
      this._pendingReadRequests.push({resolve, reject, container});
      this._source.read(container);
    });
  }

  cancel(reason) {
    if (this._cancelled) {
      return Promise.reject(new TypeError('already cancelled'));
    }

    if (this._errored) {
      return Promise.reject(this._errorReason);
    }
    if (this._closed) {
      return Promise.reject(new TypeError('already closed'));
    }

    this._cancelled = true;

    while (this._pendingReadRequests.length !== 0) {
      const request = this._pendingReadRequests.shift();
      request.reject({value: new TypeError('cancelled'), container: request.container});
    }

    this._resolveClosedPromise();
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;

    return Promise.resolve(this._source.cancel(reason));
  }

  release() {
    if (this._pendingReadRequests.length !== 0) {
      throw new TypeError('there are pending reads');
    }

    this._source = undefined;
  }

  _fulfill(value) {
    // TODO: Detach value

    if (this._source === undefined) {
      throw new TypeError('already released');
    }

    if (this._errored) {
      throw new TypeError('already errored');
    }
    if (this._closed) {
      throw new TypeError('already closed');
    }

    if (this._pendingReadRequests.length === 0) {
      throw new TypeError('no pending read request');
    }

    const request = this._pendingReadRequests.shift();
    request.resolve({done: false, value});
  }

  _close() {
    if (this._source === undefined) {
      throw new TypeError('already released');
    }

    if (this._errored) {
      throw new TypeError('already errored');
    }
    if (this._closed) {
      throw new TypeError('already closed');
    }

    this._closed = true;

    while (this._pendingReadRequests.length !== 0) {
      const request = this._pendingReadRequests.shift();
      request.resolve({done: true, container: request.container});
    }

    this._resolveClosedPromise();
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;
  }

  _error(reason) {
    if (this._source === undefined) {
      throw new TypeError('already released');
    }

    if (this._errored) {
      throw new TypeError('already errored');
    }
    if (this._closed) {
      throw new TypeError('already closed');
    }

    this._errored = true;
    this._errorReason = reason;

    while (this._pendingReadRequests.length !== 0) {
      const request = this._pendingReadRequests.shift();
      request.reject({value: reason, container: request.container});
    }

    this._rejectClosedPromise(reason);
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;
  }
}
