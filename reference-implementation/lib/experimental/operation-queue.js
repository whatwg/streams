import { Operation, OperationStatus } from './operation-stream';
import { WritableOperationStream } from './writable-operation-stream';
import { ReadableOperationStream } from './readable-operation-stream';

// Creates a pair of WritableOperationStream implementation and ReadableOperationStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createOperationQueue(strategy) {
  const source = new OperationQueueUnderlyingSource();
  const sink = new OperationQueue(strategy);

  source.setSink(sink);
  sink.setSource(source);

  return { writable: new WritableOperationStream(sink), readable: new ReadableOperationStream(source) };
}

class OperationQueueUnderlyingSource {
  setSink(sink) {
    this._sink = sink;
  }

  init(delegate) {
    this._delegate = delegate;
  }

  markReadable() {
    this._delegate.markReadable();
  }

  abort(reason) {
    this._delegate.markAborted(reason);
  }

  onWindowUpdate(v) {
    this._sink.onWindowUpdate(v);
  }

  markWaiting() {
    this._delegate.markWaiting();
  }
  markDrained() {
    this._delegate.markDrained();
  }

  read() {
    return this._sink.read();
  }

  cancel(reason) {
    return this._sink.cancel(reason);
  }
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
      this._delegate.markWaiting();
    } else {
      this._delegate.markWritable();
    }

    this._delegate.onSpaceChange();
  }

  constructor(strategy) {
    this._queue = [];
    this._queueSize = 0;

    this._strategy = strategy;
  }

  setSource(source) {
    this._source = source;
  }

  init(delegate) {
    this._delegate = delegate;

    this._updateWritableStream();
  }

  get space() {
    if (this._strategy.space !== undefined) {
      return this._strategy.space(this._queueSize);
    }

    return undefined;
  }

  write(value) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('data', value, operationStatus);

    var size = 1;
    if (this._strategy.size !== undefined) {
      size = this._strategy.size(operation.argument);
    }

    this._queue.push({value: operation, size});
    this._queueSize += size;

    this._updateWritableStream();

    this._source.markReadable();

    return operationStatus;
  }

  close() {
    const operationStatus = new OperationStatus();
    const operation = new Operation('close', ReadableOperationStream.EOS, operationStatus);

    this._queue.push({value: operation, size: 0});

    // No longer necessary.
    this._strategy = undefined;

    this._source.markReadable();

    return operationStatus;
  }

  abort(reason) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('abort', reason, operationStatus);

    for (var i = this._queue.length - 1; i >= 0; --i) {
      const op = this._queue[i].value;
      op.error(new TypeError('aborted'));
    }
    this._queue = [];

    this._strategy = undefined;

    this._source.abort(operation);

    return operationStatus;
  }

  onWindowUpdate(v) {
    if (this._strategy === undefined) {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }

    this._updateWritableStream();
  }

  read() {
    if (this._queue.length === 0) {
      throw new TypeError('not readable');
    }

    const entry = this._queue.shift();
    this._queueSize -= entry.size;

    if (this._queue.length === 0) {
      if (entry.value.type === 'close') {
        this._source.markDrained();
      } else {
        this._source.markWaiting();
      }
    }

    this._updateWritableStream();

    return entry.value;
  }

  cancel(reason) {
    const operationStatus = new OperationStatus();
    const operation = new Operation('cancel', reason, operationStatus);

    for (var i = 0; i < this._queue.length; ++i) {
      const op = this._queue[i].value;
      op.error(operation.argument);
    }
    this._queue = [];

    this._strategy = undefined;

    this._delegate.markCancelled(operation);

    return operationStatus;
  }
}
