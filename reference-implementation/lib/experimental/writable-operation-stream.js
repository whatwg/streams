import { writableAcceptsWriteAndClose, writableAcceptsAbort } from './operation-stream';
import { ExclusiveOperationStreamWriter } from './exclusive-operation-stream-writer';

export class WritableOperationStream {
  _initWritablePromise() {
    this._writablePromise = new Promise((resolve, reject) => {
      this._resolveWritablePromise = resolve;
    });
  }

  _syncStateAndWritablePromise() {
    if (this._state === 'writable') {
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
    if (this._state === 'errored') {
      // erroredPromise may be already fulfilled if this method is called on release of a writer.
      if (this._resolveErroredPromise !== undefined) {
        this._resolveErroredPromise();
        this._resolveErroredPromise = undefined;
      }
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

  constructor(sink) {
    this._sink = sink;

    this._state = 'waiting';

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });
    this._error = undefined;

    this._initWritablePromise();
    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;

    this._writer = undefined;

    const delegate = {
      markWaiting: this._markWaiting.bind(this),
      markWritable: this._markWritable.bind(this),
      markErrored: this._markErrored.bind(this),
      onSpaceChange: this._onSpaceChange.bind(this)
    };

    this._sink.init(delegate);
  }

  get state() {
    this._throwIfLocked();
    return this._state;
  }

  // Main interfaces.

  _waitSpaceChangeIgnoringLock() {
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
  waitSpaceChange() {
    this._throwIfLocked();
    return this._waitSpaceChangeIgnoringLock();
  }

  _writeIgnoringLock(value) {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    return this._sink.write(value);
  }
  write(value) {
    this._throwIfLocked();
    return this._writeIgnoringLock(value);
  }

  _closeIgnoringLock() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    const result = this._sink.close();

    this._state = 'closed';

    return result;
  }
  close() {
    this._throwIfLocked();
    return this._closeIgnoringLock();
  }

  _abortIgnoringLock(reason) {
    if (!writableAcceptsAbort(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    const result = this._sink.abort(reason);

    this._state = 'aborted';

    return result;
  }
  abort(reason) {
    this._throwIfLocked();
    return this._abortIgnoringLock(reason);
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

  get writable() {
    this._throwIfLocked();
    return this._writablePromise;
  }

  get _spaceIgnoringLock() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    return this._sink.space;
  }
  get space() {
    this._throwIfLocked();
    return this._spaceIgnoringLock;
  }

  // Locking interfaces.

  _throwIfLocked() {
    if (this._writer !== undefined) {
      throw new TypeError('locked');
    }
  }

  _releaseWriter() {
    this._writer = undefined;

    this._syncStateAndWritablePromise();
    this._syncStateAndErroredPromise();
    this._syncSpaceAndSpaceChangePromise();
  }

  getWriter() {
    this._throwIfLocked();
    this._writer = new ExclusiveOperationStreamWriter(this);
    return this._writer;
  }

  // Methods exposed only to the underlying sink.

  _markWaiting() {
    this._state = 'waiting';

    if (this._writer === undefined) {
      this._syncStateAndWritablePromise();
    } else {
      this._writer._syncStateAndWritablePromise();
    }
  }

  _markWritable() {
    this._state = 'writable';

    if (this._writer === undefined) {
      this._syncStateAndWritablePromise();
    } else {
      this._writer._syncStateAndWritablePromise();
    }
  }

  _markErrored(error) {
    this._state = 'errored';

    if (this._writer === undefined) {
      this._syncStateAndWritablePromise();
      this._syncStateAndErroredPromise();
    } else {
      this._writer._syncStateAndWritablePromise();
      this._writer._syncStateAndErroredPromise();
    }

    this._error = error;
  }

  _onSpaceChange() {
    if (this._writer === undefined) {
      this._syncSpaceAndSpaceChangePromise();
    } else {
      this._writer._syncSpaceAndSpaceChangePromise();
    }
  }
}
