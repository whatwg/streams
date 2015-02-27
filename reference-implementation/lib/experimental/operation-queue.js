import { WritableOperationStream } from './writable-operation-stream';
import { ReadableOperationStream } from './readable-operation-stream';

// Creates a pair of WritableOperationStream implementation and ReadableOperationStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createOperationQueue(strategy) {
  const queue = new OperationQueue(strategy);
  return { writable: queue.writable, readable: queue.readable };
}

class OperationQueue {
  _updateWritableSide() {
    if (this._strategy === undefined) {
      return;
    }

    let shouldApplyBackpressure = false;
    if (this._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._strategy.shouldApplyBackpressure(this._queueSize);
    }
    if (shouldApplyBackpressure) {
      this._writableSide._markWaiting();
    } else {
      this._writableSide._markWritable();
    }

    this._writableSide._onSpaceChange();
  }

  constructor(strategy) {
    this._queue = [];
    this._queueSize = 0;

    this._strategy = strategy;

    this._writableSide = new WritableOperationStream(this);
    this._readableSide = new ReadableOperationStream(this);

    this._updateWritableSide();
  }

  get writable() {
    return this._writableSide;
  }

  get readable() {
    return this._readableSide;
  }

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

    this._updateWritableSide();

    this._readableSide._markReadable();
  }

  close(operation) {
    this._queue.push({value: operation, size: 0});

    // No longer necessary.
    this._strategy = undefined;

    this._readableSide._markReadable();
  }

  abort(operation) {
    for (var i = this._queue.length - 1; i >= 0; --i) {
      const op = this._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue = [];

    this._strategy = undefined;

    this._readableSide._markAborted(operation);
  }

  onWindowUpdate(v) {
    if (this._writableSide._state === 'closed') {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }

    this._updateWritableSide();
  }

  readOperation() {
    if (this._queue.length === 0) {
      throw new TypeError('not readable');
    }

    const entry = this._queue.shift();
    this._queueSize -= entry.size;

    if (this._queue.length === 0) {
      if (entry.type === 'close') {
        this._readableSide._markDrained();
      } else {
        this._readableSide._markWaiting();
      }
    }

    this._updateWritableSide();

    return entry.value;
  }

  cancel(operation) {
    for (var i = 0; i < this._queue.length; ++i) {
      const op = this._queue[i].value;
      op.error(operation.argument);
    }
    this._queue = [];

    this._strategy = undefined;

    this._writableSide._markCancelled(operation);
  }
}
