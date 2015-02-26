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
    promises.push(readable.aborted);
  } else {
    promises.push(readable.ready);
  }

  if (writable.state === 'writable') {
    promises.push(writable.cancelled);
  } else {
    promises.push(writable.ready);
    promises.push(writable.waitSpaceChange());
  }

  return Promise.race(promises);
}

// Pipes data from source to dest with no transformation. Abort signal, cancel signal and space are also propagated
// between source and dest.
export function pipeOperationStreams(source, dest) {
  return new Promise((resolve, reject) => {
    const oldWindow = source.window;

    function restoreWindowAndReject(e) {
      source.window = oldWindow;
      reject(e);
    }

    function disposeStreams(error) {
      if (dest.state !== 'cancelled') {
        dest.cancel(error);
      }
      if (source.state !== 'aborted') {
        source.abort(error);
      }
      restoreWindowAndReject(error);
    }

    function loop() {
      for (;;) {
        if (source.state === 'aborted') {
          if (dest.state !== 'cancelled') {
            jointOps(source.abortOperation, dest.abort(source.abortOperation.argument));
          }
          restoreWindowAndReject(new TypeError('aborted'));
          return;
        }
        if (dest.state === 'cancelled') {
          if (source.state !== 'aborted') {
            jointOps(dest.cancelOperation, source.cancel(dest.cancelOperation.argument));
          }
          restoreWindowAndReject(new TypeError('dest is cancelled'));
          return;
        }

        if (dest.state === 'writable') {
          if (source.state === 'readable') {
            const op = source.read();
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
    this._initWritableReadyPromise();

    this._updateWritableState();

    this._cancelOperation = undefined;
    this._cancelledPromise = new Promise((resolve, reject) => {
      this._resolveCancelledPromise = resolve;
    });

    this._readableState = 'waiting';
    this._initReadableReadyPromise();

    this._abortOperation = undefined;
    this._abortedPromise = new Promise((resolve, reject) => {
      this._resolveAbortedPromise = resolve;
    });
  }

  _initWritableReadyPromise() {
    this._writableReadyPromise = new Promise((resolve, reject) => {
      this._resolveWritableReadyPromise = resolve;
    });
  }

  _initReadableReadyPromise() {
    this._readableReadyPromise = new Promise((resolve, reject) => {
      this._resolveReadableReadyPromise = resolve;
    });
  }

  // Writable side interfaces

  get writableState() {
    return this._writableState;
  }
  get writableReady() {
    return this._writableReadyPromise;
  }

  get cancelOperation() {
    return this._cancelOperation;
  }
  get cancelled() {
    return this._cancelledPromise;
  }

  get space() {
    if (this._writableState === 'closed' ||
        this._writableState === 'aborted' ||
        this._writableState === 'cancelled') {
      return undefined;
    }

    if (this._strategy.space !== undefined) {
      return this._strategy.space(this._queueSize);
    }

    return undefined;
  }
  waitSpaceChange() {
    if (this._spaceChangePromise !== undefined) {
      return this._spaceChangePromise;
    }

    this._spaceChangePromise = new Promise((resolve, reject) => {
      this._resolveSpaceChangePromise = resolve;
    });
    this._lastSpace = this.space;

    return this._spaceChangePromise;
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
  }

  _updateWritableState() {
    let shouldApplyBackpressure = false;
    if (this._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._strategy.shouldApplyBackpressure(this._queueSize);
    }
    if (shouldApplyBackpressure && this._writableState === 'writable') {
      this._writableState = 'waiting';
      this._initWritableReadyPromise();
    } else if (!shouldApplyBackpressure && this._writableState === 'waiting') {
      this._writableState = 'writable';
      this._resolveWritableReadyPromise();
    }

    if (this._spaceChangePromise !== undefined && this._lastSpace !== this.space) {
      this._resolveSpaceChangePromise();

      this._lastSpace = undefined;
      this._spaceChangePromise = undefined;
      this._resolveSpaceChangePromise = undefined;
    }
  }

  write(argument) {
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
      this._resolveReadableReadyPromise();
    }

    return status;
  }

  close() {
    this._checkWritableState();

    this._strategy = undefined;

    const status = new OperationStatus();
    this._queue.push({value: new Operation('close', undefined, status), size: 0});

    this._writableState = 'closed';

    if (this._readableState === 'waiting') {
      this._readableState = 'readable';
      this._resolveReadableReadyPromise();
    }

    return status;
  }

  abort(reason) {
    if (this._writableState === 'aborted') {
      throw new TypeError('already aborted');
    }
    if (this._writableState === 'cancelled') {
      throw new TypeError('already cancelled');
    }

    for (var i = this._queue.length - 1; i >= 0; --i) {
      const op = this._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue = [];
    this._strategy = undefined;

    if (this._writableState === 'waiting') {
      this._resolveWritableReadyPromise();
    }
    this._writableState = 'aborted';

    const status = new OperationStatus();
    this._abortOperation = new Operation('abort', reason, status);
    this._resolveAbortedPromise();

    if (this._readableState === 'waiting') {
      this._resolveReadableReadyPromise();
    }
    this._readableState = 'aborted';

    return status;
  }

  // Readable side interfaces.

  get readableState() {
    return this._readableState;
  }
  get readableReady() {
    return this._readableReadyPromise;
  }

  get abortOperation() {
    return this._abortOperation;
  }
  get aborted() {
    return this._abortedPromise;
  }

  get window() {
    return this._window;
  }
  set window(v) {
    this._window = v;

    if (this._writableState === 'closed' ||
        this._writableState === 'aborted' ||
        this._writableState === 'cancelled') {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }
    this._updateWritableState();
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
  }

  read() {
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
        this._initReadableReadyPromise();
      }
    }

    return entry.value;
  }

  cancel(reason) {
    this._checkReadableState();

    for (var i = 0; i < this._queue.length; ++i) {
      const op = this._queue[i].value;
      op.error(reason);
    }
    this._queue = [];
    this._strategy = undefined;

    const status = new OperationStatus();
    this._cancelOperation = new Operation('cancel', reason, status);
    this._resolveCancelledPromise();

    if (this._writableState === 'waiting') {
      this._resolveWritableReadyPromise();
    }
    this._writableState = 'cancelled';

    if (this._readableState === 'waiting') {
      this._resolveReadableReadyPromise();
    }
    this._readableState = 'cancelled';

    return status;
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
  get ready() {
    return this._stream.writableReady;
  }

  get cancelOperation() {
    return this._stream.cancelOperation;
  }
  get cancelled() {
    return this._stream.cancelled;
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
  get ready() {
    return this._stream.readableReady;
  }

  get abortOperation() {
    return this._stream.abortOperation;
  }
  get aborted() {
    return this._stream.aborted;
  }

  get window() {
    return this._stream.window;
  }
  set window(v) {
    this._stream.window = v;
  }

  read() {
    return this._stream.read();
  }
  cancel(reason) {
    return this._stream.cancel(reason);
  }
}
