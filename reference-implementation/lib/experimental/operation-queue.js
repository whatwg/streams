import { Operation, OperationStatus } from './operation-stream';
import { WritableOperationStream } from './writable-operation-stream';
import { ReadableOperationStream } from './readable-operation-stream';

// Creates a pair of WritableOperationStream implementation and ReadableOperationStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createOperationQueue(strategy) {
  const queue = new OperationQueue(strategy);
  const source = new OperationQueueUnderlyingSource(queue);
  const sink = new OperationQueueUnderlyingSink(queue);
  sink.setSource(source);
  source.setSink(sink);
  return { writable: new WritableOperationStream(sink), readable: new ReadableOperationStream(source) };
}

class OperationQueueUnderlyingSink {
  _updateWritableStream() {
    if (this._queue._strategy === undefined) {
      return;
    }

    let shouldApplyBackpressure = false;
    if (this._queue._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._queue._strategy.shouldApplyBackpressure(this._queue._queueSize);
    }
    if (shouldApplyBackpressure) {
      this._delegate.markWaiting();
    } else {
      this._delegate.markWritable();
    }

    this._delegate.onSpaceChange();
  }

  constructor(queue) {
    this._queue = queue;
  }

  setSource(source) {
    this._source = source;
  }

  init(delegate) {
    this._delegate = delegate;

    this._updateWritableStream();
  }

  get space() {
    if (this._queue._strategy.space !== undefined) {
      return this._queue._strategy.space(this._queue._queueSize);
    }

    return undefined;
  }

  write(value) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('data', value, operationStatus);

    var size = 1;
    if (this._queue._strategy.size !== undefined) {
      size = this._queue._strategy.size(operation.argument);
    }

    this._queue._queue.push({value: operation, size});
    this._queue._queueSize += size;

    this._updateWritableStream();

    this._source.onQueueFill();

    return operationStatus;
  }

  close() {
    const operationStatus = new OperationStatus();
    const operation = new Operation('close', ReadableOperationStream.EOS, operationStatus);

    this._queue._queue.push({value: operation, size: 0});

    // No longer necessary.
    this._queue._strategy = undefined;

    this._source.onQueueFill();

    return operationStatus;
  }

  abort(reason) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('abort', reason, operationStatus);

    for (var i = this._queue._queue.length - 1; i >= 0; --i) {
      const op = this._queue._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue._queue = [];

    this._queue._strategy = undefined;

    this._source.abort(operation);

    return operationStatus;
  }

  onWindowUpdate() {
    this._updateWritableStream();
  }

  onQueueConsume() {
    this._updateWritableStream();
  }

  onCancel(reason) {
    this._delegate.markCancelled(reason);
  }
}

class OperationQueueUnderlyingSource {
  constructor(queue) {
    this._queue = queue;
  }

  setSink(sink) {
    this._sink = sink;
  }

  init(delegate) {
    this._delegate = delegate;
  }

  onQueueFill() {
    this._delegate.markReadable();
  }

  abort(reason) {
    this._delegate.markAborted(reason);
  }

  onWindowUpdate(v) {
    if (this._queue._strategy === undefined) {
      return;
    }

    if (this._queue._strategy.onWindowUpdate !== undefined) {
      this._queue._strategy.onWindowUpdate(v);
    }

    this._sink.onWindowUpdate();
  }

  read() {
    if (this._queue._queue.length === 0) {
      throw new TypeError('not readable');
    }

    const entry = this._queue._queue.shift();
    this._queue._queueSize -= entry.size;

    if (this._queue._queue.length === 0) {
      if (entry.value.type === 'close') {
        this._delegate.markDrained();
      } else {
        this._delegate.markWaiting();
      }
    }

    this._sink.onQueueConsume();

    return entry.value;
  }

  cancel(reason) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('cancel', reason, operationStatus);

    for (var i = 0; i < this._queue._queue.length; ++i) {
      const op = this._queue._queue[i].value;
      op.error(operation.argument);
    }
    this._queue._queue = [];

    this._queue._strategy = undefined;

    this._sink.onCancel(operation);

    return operationStatus;
  }
}

class OperationQueue {
  constructor(strategy) {
    this._queue = [];
    this._queueSize = 0;

    this._strategy = strategy;
  }
}
