import { NewWritableStream } from './new-writable-stream';
import { NewReadableStream } from './new-readable-stream';

class StreamQueueShared {
  constructor(strategy) {
    this._queue = [];
    // Cached total size for optimization.
    this._queueSize = 0;

    this._draining = false;

    this._strategy = strategy;
  }
}

class StreamQueueUnderlyingSink {
  _updateWritableStream() {
    if (this._shared._strategy === undefined) {
      return;
    }

    let shouldApplyBackpressure = false;
    if (this._shared._strategy.shouldApplyBackpressure !== undefined) {
      shouldApplyBackpressure = this._shared._strategy.shouldApplyBackpressure(this._shared._queueSize);
    }
    if (shouldApplyBackpressure) {
      this._delegate.markWaiting();
    } else {
      this._delegate.markWritable();
    }

    this._delegate.onSpaceChange();
  }

  constructor(shared) {
    this._shared = shared;
  }

  setSource(source) {
    this._source = source;
  }

  start(delegate) {
    this._delegate = delegate;

    this._updateWritableStream();
  }

  get space() {
    if (this._shared._strategy.space !== undefined) {
      return this._shared._strategy.space(this._shared._queueSize);
    }

    return undefined;
  }

  write(value) {
    console.log('fjdiojfdosi');
    var size = 1;
    if (this._shared._strategy.size !== undefined) {
      size = this._shared._strategy.size(value);
    }

    this._shared._queue.push({value, size});
    this._shared._queueSize += size;

    this._updateWritableStream();

    this._source.onQueueFill();
  }

  close() {
    this._shared._draining = true;

    // No longer necessary.
    this._shared._strategy = undefined;

    this._source.onStartDraining();
  }

  abort(reason) {
    this._shared._queue = [];
    this._shared._strategy = undefined;

    this._source.abort(reason);
  }

  onWindowUpdate() {
    // Reflect up-to-date strategy to the WritableStream.
    this._updateWritableStream();
  }

  onQueueConsume() {
    // Reflect up-to-date status of the queue to the WritableStream.
    this._updateWritableStream();
  }

  onCancel(reason) {
    this._delegate.markErrored(reason);
  }
}

class StreamQueueUnderlyingSource {
  constructor(shared) {
    this._shared = shared;
  }

  setSink(sink) {
    this._sink = sink;
  }

  start(delegate) {
    this._delegate = delegate;
  }

  onQueueFill() {
    console.log('fjfljlkfj');

    this._delegate.markReadable();
  }

  onStartDraining() {
    if (this._shared._queue.length === 0) {
      this._delegate.markClosed();
    }
  }

  abort(reason) {
    this._delegate.markErrored(reason);
  }

  onWindowUpdate(v) {
    if (this._shared._strategy === undefined) {
      return;
    }

    if (this._shared._strategy.onWindowUpdate !== undefined) {
      this._shared._strategy.onWindowUpdate(v);
    }

    this._sink.onWindowUpdate();
  }

  read() {
    const entry = this._shared._queue.shift();

    if (this._shared._queue.length === 0) {
      if (this._shared._draining) {
        this._delegate.markClosed();
      } else {
        this._delegate.markWaiting();
      }
    }

    this._shared._queueSize -= entry.size;

    this._sink.onQueueConsume();

    return entry.value;
  }

  cancel(reason) {
    this._shared._queue = [];
    this._shared._strategy = undefined;

    this._sink.onCancel(reason);
  }
}

// Creates a pair of WritableStream implementation and ReadableStream implementation that are
// connected with a queue. This can be used for creating queue-backed operation streams.
export function createStreamQueue(strategy) {
  const shared = new StreamQueueShared(strategy);
  const source = new StreamQueueUnderlyingSource(shared);
  const sink = new StreamQueueUnderlyingSink(shared);
  sink.setSource(source);
  source.setSink(sink);
  return { writable: new NewWritableStream(sink), readable: new NewReadableStream(source) };
}
