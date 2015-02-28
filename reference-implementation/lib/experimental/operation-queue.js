import { WritableOperationStream } from './writable-operation-stream';
import { ReadableOperationStream } from './readable-operation-stream';

// Creates a pair of WritableOperationStream implementation and ReadableOperationStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createOperationQueue(strategy) {
  const queue = new OperationQueue(strategy);
  return { writable: queue.writable, readable: queue.readable };
}

class OperationQueue {
  _updateWritableStream() {
    if (this._strategy === undefined) {
      return;
    }

    let shouldApplyBackpressure = false;
    if (this._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._strategy.shouldApplyBackpressure(this._queueSize);
    }
    if (shouldApplyBackpressure) {
      this._writableStreamDelegate.markWaiting();
    } else {
      this._writableStreamDelegate.markWritable();
    }

    this._writableStreamDelegate.onSpaceChange();
  }

  constructor(strategy) {
    this._queue = [];
    this._queueSize = 0;

    this._strategy = strategy;

    this._writableStream = new WritableOperationStream(this, delegate => this._writableStreamDelegate = delegate);
    this._readableStream = new ReadableOperationStream(this, delegate => this._readableStreamDelegate = delegate);

    this._updateWritableStream();
  }

  get writable() {
    return this._writableStream;
  }

  get readable() {
    return this._readableStream;
  }

  // Underlying sink implementation.

  get space() {
    if (this._strategy.space !== undefined) {
      return this._strategy.space(this._queueSize);
    }

    return undefined;
  }

  write(operation) {
    var size = 1;
    if (this._strategy.size !== undefined) {
      size = this._strategy.size(operation.argument);
    }

    this._queue.push({value: operation, size});
    this._queueSize += size;

    this._updateWritableStream();

    this._readableStreamDelegate.markReadable();
  }

  close(operation) {
    this._queue.push({value: operation, size: 0});

    // No longer necessary.
    this._strategy = undefined;

    this._readableStreamDelegate.markReadable();
  }

  abort(operation) {
    for (var i = this._queue.length - 1; i >= 0; --i) {
      const op = this._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue = [];

    this._strategy = undefined;

    this._readableStreamDelegate.markAborted(operation);
  }

  // Underlying source implementation.

  onWindowUpdate(v) {
    if (this._strategy === undefined) {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }

    this._updateWritableStream();
  }

  readOperation() {
    if (this._queue.length === 0) {
      throw new TypeError('not readable');
    }

    const entry = this._queue.shift();
    this._queueSize -= entry.size;

    if (this._queue.length === 0) {
      if (entry.value.type === 'close') {
        this._readableStreamDelegate.markDrained();
      } else {
        this._readableStreamDelegate.markWaiting();
      }
    }

    this._updateWritableStream();

    return entry.value;
  }

  cancel(operation) {
    for (var i = 0; i < this._queue.length; ++i) {
      const op = this._queue[i].value;
      op.error(operation.argument);
    }
    this._queue = [];

    this._strategy = undefined;

    this._writableStreamDelegate.markCancelled(operation);
  }
}
