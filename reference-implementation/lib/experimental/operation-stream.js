// Creates a pair of WritableOperationStream implementation and ReadableOperationStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createOperationQueue(strategy) {
  const queue = new OperationQueue(strategy);
  return {
    writable: new OperationQueueWritableSide(queue),
    readable: new OperationQueueReadableSide(queue)
  };
}

export function jointOps(op, status) {
  function forward() {
    if (status.state === 'waiting') {
      status.ready.then(forward);
    } else if (status.state === 'errored') {
      op.error(status.result);
    } else if (status.state === 'completed') {
      op.complete(status.result);
    }
  }
  forward();
}

// Exported as a helper for building transformation.
export function selectOperationStreams(readable, writable) {
  const promises = [];

  if (readable.state === 'readable') {
    promises.push(readable.errored);
  } else {
    promises.push(readable.readable);
  }

  if (writable.state === 'writable') {
    promises.push(writable.errored);
    promises.push(writable.waitSpaceChange());
  } else {
    promises.push(writable.writable);
  }

  return Promise.race(promises);
}

// Pipes data from source to dest with no transformation. Abort signal, cancel signal and space are also propagated
// between source and dest.
export function pipeOperationStreams(source, dest) {
  return new Promise((resolve, reject) => {
    const oldWindow = source.window;

    function restoreWindowAndReject(e) {
      console.log('ssssv');
      source.window = oldWindow;
      console.log('ssssvz');
      reject(e);
    }

    function disposeStreams(error) {
      if (dest.state !== 'cancelled') {
        dest.cancel(error);
      }
      if (source.state !== 'aborted') {
        source.abort(error);
      }
      reject(error);
    }

    function writableAcceptsAbort(state) {
      return state === 'waiting' || state === 'writable' || state === 'closed';
    }

    function readableAcceptsCancel(state) {
      return state === 'waiting' || state === 'readable';
    }

    function loop() {
      for (;;) {
        // Handle interrupt.
        if (source.state === 'drained') {
          reject(new TypeError('source is drained'));
          return;
        }
        if (source.state === 'cancelled') {
          reject(new TypeError('source is cancelled'));
          return;
        }

        if (dest.state === 'closed') {
          reject(new TypeError('dest is closed'));
          return;
        }
        if (dest.state === 'aborted') {
          reject(new TypeError('dest is aborted'));
          return;
        }

        // Propagate errors.

        if (source.state === 'aborted') {
          if (writableAcceptsAbort(dest.state)) {
            jointOps(source.abortOperation, dest.abort(source.abortOperation.argument));
          }
          reject(new TypeError('aborted'));
          return;
        }
        if (source.state === 'errored') {
          const error = new TypeError('source is errored');
          if (writableAcceptsAbort(dest.state)) {
            dest.abort(error);
          }
          reject(error);
          return;
        }

        if (dest.state === 'cancelled') {
          if (readableAcceptsCancel(source.state)) {
            jointOps(dest.cancelOperation, source.cancel(dest.cancelOperation.argument));
          }
          reject(new TypeError('dest is cancelled'));
          return;
        }
        if (source.state === 'errored') {
          const error = new TypeError('dest is errored');
          if (readableAcceptsCancel(source.state)) {
            source.cancel(error);
          }
          reject(error);
          return;
        }

        if (dest.state === 'writable') {
          if (source.state === 'readable') {
            const op = source.readOperation();
            if (op.type === 'data') {
              jointOps(op, dest.write(op.argument));
            } else if (op.type === 'close') {
              jointOps(op, dest.close());

              source.window = oldWindow;
              resolve();

              return;
            } else {
              const error = new TypeError('unexpected operation type: ' + op.type);
              disposeStreams(error);
              return;
            }

            continue;
          } else {
            source.window = dest.space;
          }
        }

        selectOperationStreams(source, dest)
            .then(loop)
            .catch(disposeStreams);
        return;
      }
    }
    loop();
  });
}

class OperationStatus {
  constructor() {
    this._state = 'waiting';
    this._result = undefined;
    this._readyPromise = new Promise((resolve, reject) => {
      this._resolveReadyPromise = resolve;
    });
  }

  _onCompletion(v) {
    this._state = 'completed';
    this._result = v;
    this._resolveReadyPromise();
    this._resolveReadyPromise = undefined;
  }
  _onError(e) {
    this._state = 'errored';
    this._result = e;
    this._resolveReadyPromise();
    this._resolveReadyPromise = undefined;
  }

  get state() {
    return this._state;
  }
  get result() {
    return this._result;
  }
  get ready() {
    return this._readyPromise;
  }
}

class Operation {
  constructor(type, argument, status) {
    this._type = type;
    this._argument = argument;
    this._status = status;
  }

  get type() {
    return this._type;
  }
  get argument() {
    return this._argument;
  }

  complete(result) {
    this._status._onCompletion(result);
  }
  error(reason) {
    this._status._onError(reason);
  }
}

class OperationQueue {
  constructor(strategy) {
    this._queue = [];
    this._queueSize = 0;

    this._strategy = strategy;

    this._lastSpace = undefined;
    this._spaceChangePromise = undefined;

    this._window = 0;

    this._writableState = 'waiting';
    this._initWritablePromise();

    this._erroredPromise = new Promise((resolve, reject) => {
      this._resolveErroredPromise = resolve;
    });

    this._updateWritableState();

    this._cancelOperation = undefined;

    this._abortOperation = undefined;

    this._readableState = 'waiting';
    this._initReadablePromise();

  }

  _initWritablePromise() {
    this._writablePromise = new Promise((resolve, reject) => {
      this._resolveWritablePromise = resolve;
    });
  }

  _initReadablePromise() {
    this._readablePromise = new Promise((resolve, reject) => {
      this._resolveReadablePromise = resolve;
    });
  }

  // Writable side interfaces

  _throwIfWritableLocked() {
    if (this._writer !== undefined) {
      throw new TypeError('locked');
    }
  }

  get writableState() {
    this._throwIfWritableLocked();
    return this._writableState;
  }
  get writable() {
    this._throwIfWritableLocked();
    return this._writablePromise;
  }
  get writableErrored() {
    this._throwIfWritableLocked();
    return this._erroredPromise;
  }

  get _cancelOperationInternal() {
    if (this._writableState !== 'cancelled') {
      throw new TypeError('not cancelled');
    }
    return this._cancelOperation;
  }
  get cancelOperation() {
    this._throwIfWritableLocked();
    return this._cancelOperationInternal;
  }

  _checkWritableState() {
    if (this._writableState === 'closed') {
      throw new TypeError('already closed');
    }
    if (this._writableState === 'aborted') {
      throw new TypeError('already aborted');
    }
    if (this._writableState === 'cancelled') {
      throw new TypeError('already cancelled');
    }
    if (this._writableState === 'errored') {
      throw new TypeError('already errored');
    }
  }

  get _spaceInternal() {
    this._checkWritableState();

    if (this._strategy.space !== undefined) {
      return this._strategy.space(this._queueSize);
    }

    return undefined;
  }
  get space() {
    this._throwIfWritableLocked();
    return this._spaceInternal;
  }
  _waitSpaceChangeInternal() {
    this._checkWritableState();

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
    this._throwIfWritableLocked();
    return this._waitSpaceChangeInternal();
  }

  _updateWritableState() {
    let shouldApplyBackpressure = false;
    if (this._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._strategy.shouldApplyBackpressure(this._queueSize);
    }
    if (shouldApplyBackpressure && this._writableState === 'writable') {
      this._writableState = 'waiting';
      this._initWritablePromise();
    } else if (!shouldApplyBackpressure && this._writableState === 'waiting') {
      this._writableState = 'writable';
      this._resolveWritablePromise();
    }

    if (this._spaceChangePromise !== undefined && this._lastSpace !== this.space) {
      this._resolveSpaceChangePromise();

      this._lastSpace = undefined;
      this._spaceChangePromise = undefined;
      this._resolveSpaceChangePromise = undefined;
    }
  }

  _writeInternal(argument) {
    this._checkWritableState();

    var size = 1;
    if (this._strategy.size !== undefined) {
      size = this._strategy.size(argument);
    }

    const status = new OperationStatus();
    this._queue.push({value: new Operation('data', argument, status), size});
    this._queueSize += size;

    this._updateWritableState();

    if (this._readableState === 'waiting') {
      this._readableState = 'readable';
      this._resolveReadablePromise();
    }

    return status;
  }
  write(argument) {
    this._throwIfWritableLocked();
    return this._writeInternal(argument);
  }

  _closeInternal() {
    this._checkWritableState();

    this._strategy = undefined;

    const status = new OperationStatus();
    this._queue.push({value: new Operation('close', undefined, status), size: 0});

    this._writableState = 'closed';

    if (this._readableState === 'waiting') {
      this._readableState = 'readable';
      this._resolveReadablePromise();
    }

    return status;
  }
  close() {
    this._throwIfWritableLocked();
    return this._closeInternal();
  }

  _abortInternal(reason) {
    if (this._writableState === 'aborted') {
      throw new TypeError('already aborted');
    }
    if (this._writableState === 'cancelled') {
      throw new TypeError('already cancelled');
    }
    if (this._writableState === 'errored') {
      throw new TypeError('already errored');
    }

    for (var i = this._queue.length - 1; i >= 0; --i) {
      const op = this._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue = [];
    this._strategy = undefined;

    this._resolveErroredPromise();

    if (this._writableState === 'waiting') {
      this._resolveWritablePromise();
    }
    this._writableState = 'aborted';

    const status = new OperationStatus();
    this._abortOperation = new Operation('abort', reason, status);

    if (this._readableState === 'waiting') {
      this._resolveReadablePromise();
    }
    this._readableState = 'aborted';

    return status;
  }
  abort(reason) {
    this._throwIfWritableLocked();
    return this._abortInternal(reason);
  }

  getWriter() {
    this._throwIfWritableLocked();
    this._writer = new ExclusiveOperationQueueWriter(this);
    return this._writer;
  }

  // Readable side interfaces.

  _throwIfReadableLocked() {
    if (this._reader !== undefined) {
      throw new TypeError('locked');
    }
  }

  get readableState() {
    this._throwIfReadableLocked();
    return this._readableState;
  }
  get readable() {
    this._throwIfReadableLocked();
    return this._readablePromise;
  }
  get readableErrored() {
    this._throwIfReadableLocked();
    return this._erroredPromise;
  }

  get _abortOperationInternal() {
    if (this._writableState !== 'aborted') {
      throw new TypeError('not aborted');
    }
    return this._abortOperation;
  }
  get abortOperation() {
    this._throwIfReadableLocked();
    return this._abortOperationInternal;
  }

  _checkReadableState() {
    if (this._readableState === 'drained') {
      throw new TypeError('already drained');
    }
    if (this._readableState === 'cancelled') {
      throw new TypeError('already cancelled');
    }
    if (this._readableState === 'aborted') {
      throw new TypeError('already aborted');
    }
    if (this._readableState === 'errored') {
      throw new TypeError('already errored');
    }
  }

  get _windowInternal() {
    return this._window;
  }
  get window() {
    this._throwIfReadableLocked();
    return this._windowInternal;
  }
  set _windowInternal(v) {
    this._checkReadableState();

    this._window = v;

    if (this._writableState === 'closed') {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }
    this._updateWritableState();
  }
  set window(v) {
    this._throwIfReadableLocked();
    this._windowInternal = v;
  }

  _readInternal() {
    this._checkReadableState();

    if (this._queue.length === 0) {
      throw new TypeError('not readable');
    }

    const entry = this._queue.shift();
    this._queueSize -= entry.size;

    if (this._writableState === 'writable' ||
        this._writableState === 'waiting') {
      this._updateWritableState();
    }

    if (this._queue.length === 0) {
      if (entry.type === 'close') {
        this._readableState = 'drained';
      } else {
        this._readableState = 'waiting';
        this._initReadablePromise();
      }
    }

    return entry.value;
  }
  read() {
    this._throwIfReadableLocked();
    return this._readInternal();
  }

  _cancelInternal(reason) {
    this._checkReadableState();

    for (var i = 0; i < this._queue.length; ++i) {
      const op = this._queue[i].value;
      op.error(reason);
    }
    this._queue = [];
    this._strategy = undefined;

    this._resolveErroredPromise();

    const status = new OperationStatus();
    this._cancelOperation = new Operation('cancel', reason, status);

    if (this._writableState === 'waiting') {
      this._resolveWritablePromise();
    }
    this._writableState = 'cancelled';

    if (this._readableState === 'waiting') {
      this._resolveReadablePromise();
    }
    this._readableState = 'cancelled';

    return status;
  }
  cancel(reason) {
    this._throwIfReadableLocked();
    return this._cancelInternal(reason);
  }

  getReader() {
    this._throwIfReadableLocked();
    this._reader = new ExclusiveOperationQueueWriter(this);
    return this._reader;
  }
}

// A wrapper to expose only the interfaces of writable side implementing the WritableOperationStream interface.
class OperationQueueWritableSide {
  constructor(stream) {
    this._stream = stream;
  }

  get state() {
    return this._stream.writableState;
  }
  get writable() {
    return this._stream.writable;
  }
  get errored() {
    return this._stream.writableErrored;
  }

  get cancelOperation() {
    return this._stream.cancelOperation;
  }

  get window() {
    return this._stream.window;
  }
  set window(v) {
    this._stream.window = v;
  }

  get space() {
    return this._stream.space;
  }
  waitSpaceChange() {
    return this._stream.waitSpaceChange();
  }

  write(value) {
    return this._stream.write(value);
  }
  close() {
    return this._stream.close();
  }
  abort(reason) {
    return this._stream.abort(reason);
  }
}

// A wrapper to expose only the interfaces of readable side implementing the ReadableOperationStream interface.
class OperationQueueReadableSide {
  constructor(stream) {
    this._stream = stream;
  }

  get state() {
    return this._stream.readableState;
  }
  get readable() {
    return this._stream.readable;
  }
  get errored() {
    return this._stream.readableErrored;
  }

  get abortOperation() {
    return this._stream.abortOperation;
  }

  get window() {
    return this._stream.window;
  }
  set window(v) {
    this._stream.window = v;
  }

  read() {
    const op = this._stream.read();
    if (op.type === 'data') {
      return op.argument;
    } else if (op.type === 'close') {
      return ReadableOperationStream.EOS;
    }
  }
  readOperation() {
    return this._stream.read();
  }
  cancel(reason) {
    return this._stream.cancel(reason);
  }
}

class ReadableOperationStream {
}

ReadableOperationStream.EOS = {};
