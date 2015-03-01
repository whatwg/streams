export class ExclusiveOperationStreamWriter {
  _initWritablePromise() {
    this._writablePromise = new Promise((resolve, reject) => {
      this._resolveWritablePromise = resolve;
    });
  }

  constructor(parent) {
    this._parent = parent;

    this._initWritablePromise();
    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });

    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;

    this._syncStateAndWritablePromise();
    this._syncStateAndErroredPromise();
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

  _syncStateAndWritablePromise() {
    if (this._parent._state === 'writable') {
      if (this._resolveWritablePromise !== undefined) {
        this._resolveWritablePromise();
        this._resolveWritablePromise = undefined;
      }
    } else {
      if (this._resolveWritablePromise === undefined) {
        this._initWritablePromise();
      }
    }
  }

  _syncStateAndErroredPromise() {
    if (this._parent._state === 'cancelled' || this._parent._state === 'errored') {
      this._resolveErroredPromise();
      this._resolveErroredPromise = undefined;
    }
  }

  _syncSpaceAndSpaceChangePromise() {
    if (this._spaceChangePromise !== undefined && this._lastSpace !== this.space) {
      this._resolveSpaceChangePromise();
      this._resolveSpaceChangePromise = undefined;

      this._lastSpace = undefined;
      this._spaceChangePromise = undefined;
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
    this._parent._releaseWriter();

    this._parent = undefined;

    this._writablePromise = undefined;
    this._erroredPromise = undefined;
    this._spaceChangePromise = undefined;
  }
}
