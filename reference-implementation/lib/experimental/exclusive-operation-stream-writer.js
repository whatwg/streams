class ExclusiveOperationStreamWriter {
  _initWritablePromise() {
    this._writablePromise = new Promise((resolve, reject) => {
      this._resolveWritablePromise = resolve;
    });
  }

  constructor(parent) {
    this._parent = parent;

    const state = this._parent._state;

    if (state === 'writable') {
      this._writablePromise = Promise.resolve();
    } else {
      this._initWritablePromise();
    }

    if (state === 'errored' || state === 'cancelled') {
      this._erroredPromise = Promise.resolve();
    } else {
      this._erroredPromise = new Promise((resolve, reject) => {
        this._resolveErroredPromise = resolve;
      });
    }

    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;
  }

  _throwIfReleased() {
    if (this._parent === undefined) {
      throw new TypeError('already released');
    }
  }

  get state() {
    this._throwIfReleased();
    return this._parent._state;
  }
  get writable() {
    this._throwIfReleased();
    return this._writablePromise;
  }
  get errored() {
    this._throwIfReleased();
    return this._erroredPromise;
  }

  get cancelOperation() {
    this._throwIfReleased();
    return this._parent._cancelOperationIgnoringLock;
  }

  _onSpaceChange() {
    if (this._spaceChangePromise !== undefined && this._lastSpace !== this.space) {
      this._resolveSpaceChangePromise();

      this._lastSpace = undefined;
      this._spaceChangePromise = undefined;
      this._resolveSpaceChangePromise = undefined;
    }
  }

  get space() {
    this._throwIfReleased();
    return this._parent._spaceIgnoringLock;
  }
  waitSpaceChange() {
    this._throwIfReleased();

    if (this._spaceChangePromise !== undefined) {
      return this._spaceChangePromise;
    }

    this._spaceChangePromise = new Promise((resolve, reject) => {
      this._resolveSpaceChangePromise = resolve;
    });
    this._lastSpace = this.space;

    return this._spaceChangePromise;
  }

  write(argument) {
    this._throwIfReleased();
    return this._parent._writeIgnoringLock(argument);
  }
  close() {
    this._throwIfReleased();
    return this._parent._closeIgnoringLock();
  }
  abort(reason) {
    this._throwIfReleased();
    return this._parent._abortIgnoringLock(reason);
  }

  release() {
    this._parent._onWriterRelease();

    this._parent = undefined;

    this._writablePromise = undefined;
    this._erroredPromise = undefined;
    this._spaceChangePromise = undefined;
  }
}
