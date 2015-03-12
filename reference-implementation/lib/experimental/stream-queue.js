import { ThinStreamWriter } from './thin-stream-writer';
import { ThinStreamReader } from './thin-stream-reader';

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

  start(markReadable, markClosed, markErrored) {
    this._markReadable = markReadable;
    this._markClosed = markClosed;
    this._markErrored = markErrored;
  }

  onQueueFill() {
    if (this._markReadable === undefined) {
      return;
    }

    this._markReadable();
    this._markReadable = undefined;
    this._markClosed = undefined;
  }

  onStartDraining() {
    if (this._shared._queue.length !== 0 || this._markClosed === undefined) {
      return;
    }

    this._markClosed();
    this._markReadable = undefined;
    this._markClosed = undefined;
  }

  abort(reason) {
    if (this._markErrored === undefined) {
      return;
    }

    this._markErrored(reason);
    this._markErrored = undefined;
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

  read(markReadable, markClosed) {
    const entry = this._shared._queue.shift();

    if (this._shared._queue.length === 0) {
      if (this._shared._draining) {
        markClosed();
      }
    } else {
      markReadable();
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
  return { writable: new ThinStreamWriter(sink), readable: new ThinStreamReader(source) };
}
