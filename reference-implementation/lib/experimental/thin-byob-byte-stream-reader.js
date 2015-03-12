export class ThinByobByteStreamReader {
  constructor(source) {
    this._source = source;

    // Stores a tuple of the following data for reader.read() calls which were made after the reader is closed or
    // errored until the underlying source finishes returning all the buffers given to the underlying source:
    // - the Uint8Array provided by the user of the reader on the reader.read() call
    // - resolution/rejection function of the promise returned to the user of the reader on the reader.read() call
    this._pendingReads = [];
    // Stores a tuple of the following data for _source.read() calls which are not yet fulfilled:
    // - the Uint8Array given to the source
    // - resolution/rejection function of the promise returned to the user of the reader on the corresponding
    //   reader.read() call
    this._pendingSourceReads = [];

    // True when closed but the source may still return the given buffers using done().
    this._closed = false;

    // True when errored but the source may still return the given buffers using done().
    this._errored = false;
    this._errorReason = undefined;

    // True when errored and the source cannot return the given buffers.
    this._fatalErrored = false;

    this._closedPromise = new Promise((resolve, reject) => {
      this._resolveClosedPromise = resolve;
      this._rejectClosedPromise = reject;
    });

    if (this._source.start !== undefined) {
      this._source.start(this._close.bind(this), this._error.bind(this), this._fatalError.bind(this));
    }
  }

  get closed() {
    return this._closedPromise;
  }

  _processPendingReads() {
    while (this._pendingReads.length > 0) {
      const entry = this._pendingReads.shift();
      if (this._fatalErrored) {
        entry.reject({reason: this._errorReason, view: undefined});
      } else if (this._errored) {
        entry.reject({reason: this._errorReason, view: entry.view.subarray(0, 0)});
      } else if (this._closed) {
        entry.resolve({view: entry.view.subarray(0, 0), done: true});
      } else if (this._source === undefined) {
        entry.reject({reason: new TypeError('already released'), view: entry.view.subarray(0, 0)});
      } else {
        // Not reached
      }
    }
  }

  _handleFatalError(reason) {
    this._fatalErrored = true;
    this._errorReason = reason;

    while (this._pendingSourceReads.length > 0) {
      const entry = this._pendingSourceReads.shift();
      entry.reject({reason, view: undefined});
    }

    this._processPendingReads();
  }

  // Tell the stream that the underlying source has done or aborted writing to the oldest pending view.
  _done(bytesWritten) {
    if (this._fatalErrored) {
      throw new TypeError('already fatal-errored');
    }

    if (this._pendingSourceReads.length === 0) {
      throw new TypeError('no pending read');
    }
    const entry = this._pendingSourceReads.shift();

    // TODO: Detach entry.view

    if (this._errored) {
      entry.reject({reason: this._errorReason, view: entry.view.subarray(0, 0)});
      if (this._pendingSourceReads.length === 0) {
        this._processPendingReads();
      }
      return;
    }
    if (this._closed) {
      entry.resolve({value: entry.view.subarray(0, 0), done: true});
      if (this._pendingSourceReads.length === 0) {
        this._processPendingReads();
      }
      return;
    }

    if (bytesWritten === undefined) {
      throw new TypeError('bytesWritten is undefined');
    }

    if (entry.view.byteLength < bytesWritten) {
      throw new RangeError('bytesWritten is bigger than the given view');
    }

    entry.resolve({value: entry.view.subarray(0, bytesWritten), done: false});
  }

  _markClosed() {
    this._closed = true;

    this._resolveClosedPromise();
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;
  }

  _close() {
    if (this._fatalErrored) {
      throw new TypeError('already fatal-errored');
    }
    if (this._errored) {
      throw new TypeError('already errored');
    }
    if (this._closed) {
      throw new TypeError('already closed');
    }

    this._markClosed();
  }

  _markErrored(reason) {
    this._errored = true;
    this._errorReason = reason;

    this._rejectClosedPromise(reason);
    this._resolveClosedPromise = undefined;
    this._rejectClosedPromise = undefined;
  }

  _error(reason) {
    if (this._fatalErrored) {
      throw new TypeError('already fatal-errored');
    }
    if (this._errored) {
      throw new TypeError('already errored');
    }
    if (this._closed) {
      throw new TypeError('already closed');
    }

    this._markErrored(reason);
  }

  _fatalError(reason) {
    if (this._fatalErrored) {
      throw new TypeError('already fatal-errored');
    }

    this._handleFatalError(reason);
  }

  read(view) {
    if (this._fatalErrored) {
      return Promise.reject({reason: this._errorReason, view: undefined});
    }

    return new Promise((resolve, reject) => {
      if (this._errored || this._closed || this._source === undefined) {
        if (this._pendingSourceReads.length > 0) {
          this._pendingReads.push({view, resolve, reject});
        } else {
          if (this._errored) {
            reject({reason: this._errorReason, view: view.subarray(0, 0)});
          } else if (this._closed) {
            resolve({value: view.subarray(0, 0), done: true});
          } else {
            reject({reason: new TypeError('already released'), view: view.subarray(0, 0)});
          }
        }
        return;
      }

      // TODO: Detach view

      this._pendingSourceReads.push({view, resolve, reject});

      try {
        this._source.read(
            view,
            this._done.bind(this),
            this._close.bind(this),
            this._error.bind(this),
            this._fatalError.bind(this));
      } catch (e) {
        if (!(this._fatalErrored || this._errored || this._closed)) {
          this._markErrored(e);
        }
      }
    });
  }

  cancel(reason) {
    if (this._source === undefined) {
      return Promise.reject(new TypeError('already released'));
    }

    if (this._fatalErrored || this._errored) {
      return Promise.reject(this._errorReason);
    }

    if (this._closed) {
      return Promise.reject(new TypeError('already closed'));
    }

    this._markClosed();

    return new Promise((resolve, reject) => {
      resolve(this._source.cancel(reason));
    }).then(r => undefined);
  }

  releaseLock() {
    if (this._source === undefined) {
      throw new TypeError('already released');
    }

    this._source = undefined;
  }
}
