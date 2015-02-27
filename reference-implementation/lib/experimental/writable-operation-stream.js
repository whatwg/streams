import { Operation, OperationStatus, writableAcceptsWriteAndClose, writableAcceptsAbort } from './operation-stream.js';
import { ExclusiveOperationStreamWriter } from './exclusive-operation-stream-writer.js';

class WritableOperationStream {
  _initWritablePromise() {
    this._writablePromise = new Promise((resolve, reject) => {
      this._resolveWritablePromise = resolve;
    });
  }

  constructor() {
    this._state = 'waiting';

    this._initWritablePromise();

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });

    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;

    this._cancelOperation = undefined;

    this._writer = undefined;
  }

  _throwIfLocked() {
    if (this._writer !== undefined) {
      throw new TypeError('locked');
    }
  }

  _markWaiting() {
    if (this._state !== 'writable') {
      return;
    }

    if (this._writer === undefined) {
      this._initWritablePromise();
    } else {
      this._writer._initWritablePromise();
    }

    this._state = 'waiting';
  }

  _onSpaceChange() {
    if (this._writer === undefined) {
      if (this._spaceChangePromise !== undefined && this._lastSpace !== this.space) {
        this._resolveSpaceChangePromise();

        this._lastSpace = undefined;
        this._spaceChangePromise = undefined;
        this._resolveSpaceChangePromise = undefined;
      }
    } else {
      this._writer._onSpaceChange();
    }
  }

  _markCancelled(operation) {
    this._state = 'cancelled';

    if (this._writer === undefined) {
      this._resolveErroredPromise();
    } else {
      this._writer._resolveErroredPromise();
    }

    this._cancelOperation = operation;
  }

  _markWritable() {
    if (this._state === 'waiting') {
      if (this._writer === undefined) {
        this._resolveWritablePromise();
      } else {
        this._writer._resolveWritablePromise();
      }

      this._state = 'writable';
    }
  }

  get state() {
    this._throwIfLocked();
    return this._state;
  }
  get writable() {
    this._throwIfLocked();
    return this._writablePromise;
  }
  get errored() {
    this._throwIfLocked();
    return this._erroredPromise;
  }

  get _cancelOperationIgnoringLock() {
    if (this._state !== 'cancelled') {
      throw new TypeError('not cancelled');
    }
    return this._cancelOperation;
  }
  get cancelOperation() {
    this._throwIfLocked();
    return this._cancelOperationIgnoringLock;
  }

  _checkState() {
    if (!writableAcceptsWriteAndClose(this._state)) {
      throw new TypeError('already ' + this._state);
    }
  }

  get _spaceIgnoringLock() {
    this._checkState();
    return this._spaceInternal();
  }
  get space() {
    this._throwIfLocked();
    return this._spaceIgnoringLock;
  }

  _waitSpaceChangeIgnoringLock() {
    this._checkState();

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

  _writeIgnoringLock(argument) {
    this._checkState();

    const operationStatus = new OperationStatus();
    const operation = new Operation('data', argument, operationStatus);

    this._writeInternal(operation);

    return operationStatus;
  }
  write(argument) {
    this._throwIfLocked();
    return this._writeIgnoringLock(argument);
  }

  _closeIgnoringLock() {
    this._checkState();

    const operationStatus = new OperationStatus();
    const operation = new Operation('close', undefined, operationStatus);

    this._closeInternal(operation);

    this._state = 'closed';

    return operationStatus;
  }
  close() {
    this._throwIfLocked();
    return this._closeIgnoringLock();
  }

  _abortIgnoringLock(reason) {
    if (!writableAcceptsAbort(this._state)) {
      throw new TypeError('already ' + this._state);
    }

    const operationStatus = new OperationStatus();
    const operation = new Operation('abort', reason, operationStatus);

    this._abortInternal(operation);

    this._state = 'aborted';

    return operationStatus;
  }
  abort(reason) {
    this._throwIfLocked();
    return this._abortIgnoringLock(reason);
  }

  getWriter() {
    this._throwIfLocked();
    this._writer = new ExclusiveOperationStreamWriter(this);
    return this._writer;
  }
}
