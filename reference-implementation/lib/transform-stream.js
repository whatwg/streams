'use strict';
const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');

// Functions passed to the transformer.start().

function TransformStreamCloseReadable(stream) {
  if (stream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (stream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  try {
    stream._readableController.close();
  } catch (e) {
    assert(false);
  }

  stream._readableClosed = true;
}

function TransformStreamEnqueueToReadable(stream, chunk) {
  if (stream._errroed === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (stream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  // We throttle transformer.transform invoation based on the backpressure of the ReadableStream, but we still
  // accept TrasnformStreamEnqueueToReadable() calls.

  const controller = stream._readableController;

  stream._readableBackpressure = true;

  try {
    controller.enqueue(chunk);
  } catch (e) {
    // This happens when the given strategy is bad.
    const reason = new TypeError('Failed to enqueue to readable side');
    TransforStreamError(stream, reason);
    throw reason;
  }

  let backpressure;
  try {
    backpressure = controller.desiredSize() <= 0;
  } catch (e) {
    const reason = new TypeError('Failed to calculate backpressure of readable side');
    TransformStreamError(stream, reason);
    throw reason;
  }

  // enqueue() may invoke pull() synchronously when we're not in pull() call.
  // In such case, _readableBackpressure may be already set to false.
  if (backpressure) {
    stream._readableBackpressure = false;
  }
}

function TransformStreamError(stream, e) {
  if (stream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  TransformStreamErrorInternal(stream, e);
}

// Functions passed to transformer.transform().

function TransformStreamChunkDone(stream) {
  if (stream._errroed === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (stream._transforming !== true) {
    throw new TypeError('No active transform is running');
  }

  assert(stream._resolveWrite !== undefined);

  stream._transforming = false;

  stream._resolveWrite(undefined);
  stream._resolveWriter = undefined;
}

// Abstract operations.

function TransformStreamErrorInternal(stream, e) {
  stream._errored = true;

  if (stream._writableDone === false) {
    stream._writableController.error(e);
  }
  if (stream._readableClosed === false) {
    stream._readableController.error(e);
  }

  stream._chunk = undefined;

  if (stream._resolveWriter !== undefined) {
    stream._resolveWriter(undefined);
  }
}

function TransformStreamTransformIfNeeded(stream) {
  if (stream._transforming === true) {
    return;
  }

  if (stream._chunkPending === false) {
    return;
  }

  if (stream._readableBackpressure === true) {
    return;
  }

  assert(stream._resolveWrite !== undefined);

  stream._transforming = true;

  const chunk = stream._chunk;
  stream._chunkPending = false;
  stream._chunk = undefined;

  try {
    stream._transformer.transform(chunk, TransformStreamChunkDone.bind(stream));
  } catch (e) {
    if (stream._errored === false) {
      TransformStreamErrorInternal(stream, e);
    }
  }
}

function TransformStreamStart(stream) {
  const enqueueFunction = TransformStreamEnqueueToReadable.bind(stream);
  const closeFunction = TransformStreamCloseReadable.bind(stream);

  const errorFunction = TransformStreamError.bind(stream);

  // Thrown exception will be handled by the constructor of TransformStream.
  stream._transformer.start(enqueueFunction, closeFunction, errorFunction);
}

class TransformStreamSink {
  constructor(transformStream) {
    this._transformStream = transformStream;
  }

  start(c) {
    const stream = this._transformStream;

    stream._writableController = c;

    if (stream._readableController !== undefined) {
      TransformStreamStart(stream);
    }
  }

  write(chunk) {
    const stream = this._transformStream;

    assert(stream._errored === false);

    assert(stream._chunkPending === false);
    assert(stream._chunk === undefined);
    assert(stream._resolveWrite === undefined);

    stream._chunkPending = true;
    stream._chunk = chunk;
    const promise = new Promise(resolve => {
      stream._resolveWrite = resolve;
    });

    TransformStreamTransformIfNeeded(stream);

    return promise;
  }

  abort(reason) {
    const stream = this._transformStream;
    stream._writableDone = true;
    TransformStreamErrorInternal(stream, new TypeError('Writable side aborted'));
  }

  close() {
    const stream = this._transformStream;

    assert(stream._chunkPending === false);
    assert(stream._chunk === undefined);
    assert(stream._resolveWrite === undefined);

    assert(stream._transforming === false);

    const rc = stream._readableController;

    // No control over the promise returned by writableStream.close(). Need it?

    const flush = stream._transformer.flush;

    if (flush === undefined) {
      try {
        TransformStreamCloseReadable(stream);
      } catch (e) {
        TransformStreamError(new TypeError('TransformStream is broken'));
      }
    } else {
      try {
        flush();
      } catch (e) {
        if (stream._errored === false) {
          TransformStreamError(stream, e);
        }
      }
    }
  }
}

class TransformStreamSource {
  constructor(transformStream) {
    this._transformStream = transformStream;
  }

  start(c) {
    const stream = this._transformStream;

    stream._readableController = c;

    if (stream._writableController !== undefined) {
      TransformStreamStart(stream);
    }
  }

  pull() {
    this._transformStream._outputBackpressure = false;
    TransformStreamTransformIfNeeded(this._transformStream);
  }

  cancel(reason) {
    const stream = this._transformStream;
    stream._readableClosed = true;
    TransformStreamErrorInternal(stream, new TypeError('Readable side canceled'));
  }
}

module.exports = class TransformStream {
  constructor(transformer) {
    if (transformer.flush !== undefined && typeof transformer.flush !== 'function') {
      throw new TypeError('flush must be a function or undefined');
    }
    if (typeof transformer.transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    this._transformer = transformer;

    this._transforming = false;
    this._errored = false;

    this._writableController = undefined;
    this._readableController = undefined;

    this._resolveWrite = undefined;

    this._chunkPending = false;
    this._chunk = undefined;

    const sink = new TransformStreamSink(this);

    try {
      this.writable = new WritableStream(sink, transformer.writableStrategy);
    } catch (e) {
      if (this._errored === false) {
        TransformStreamError(this, e);
        throw e;
      }
      return;
    }

    const source = new TransformStreamSource(this);

    try {
      this.readable = new ReadableStream(source, transformer.readableStrategy);
    } catch (e) {
      if (this._errored === false) {
        TransformStreamError(this, e);
        throw e;
      }
    }
  }
};
