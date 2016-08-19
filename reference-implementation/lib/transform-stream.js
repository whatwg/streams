'use strict';
const assert = require('assert');
const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');

// Functions passed to the transformer.start().

function TransformStreamCloseReadable(transformStream) {
  // console.log('TransformStreamCloseReadable()');

  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  try {
    transformStream._readableController.close();
  } catch (e) {
    assert(false);
  }

  transformStream._readableClosed = true;
}

function TransformStreamEnqueueToReadable(transformStream, chunk) {
  if (transformStream._errroed === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  // We throttle transformer.transform invoation based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamEnqueueToReadable() calls.

  const controller = transformStream._readableController;

  transformStream._readableBackpressure = true;

  try {
    controller.enqueue(chunk);
  } catch (e) {
    if (transformStream._error === false) {
      // This happens when the given strategy is bad.
      const reason = new TypeError('Failed to enqueue to readable side');
      TransformStreamErrorInternal(transformStream, reason);
    }
    throw transformStream._error;
  }

  let backpressure;
  try {
    backpressure = controller.desiredSize <= 0;
  } catch (e) {
    if (transformStream._error === false) {
      const reason = new TypeError('Failed to calculate backpressure of readable side');
      TransformStreamError(transformStream, reason);
    }
    throw transformStream._error;
  }

  // enqueue() may invoke pull() synchronously when we're not in pull() call.
  // In such case, _readableBackpressure may be already set to false.
  if (backpressure) {
    transformStream._readableBackpressure = false;
  }
}

function TransformStreamError(transformStream, e) {
  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  TransformStreamErrorInternal(transformStream, e);
}

// Functions passed to transformer.transform().

function TransformStreamChunkDone(transformStream) {
  if (transformStream._errroed === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._transforming === false) {
    throw new TypeError('No active transform is running');
  }

  assert(transformStream._resolveWrite !== undefined);

  transformStream._transforming = false;

  transformStream._resolveWrite(undefined);
  transformStream._resolveWrite = undefined;

  TransformStreamTransformIfNeeded(transformStream);
}

// Abstract operations.

function TransformStreamErrorInternal(transformStream, e) {
  // console.log('TransformStreamErrorInternal()');

  transformStream._errored = true;

  if (transformStream._writableDone === false) {
    transformStream._writableController.error(e);
  }
  if (transformStream._readableClosed === false) {
    transformStream._readableController.error(e);
  }

  transformStream._chunk = undefined;

  if (transformStream._resolveWriter !== undefined) {
    transformStream._resolveWriter(undefined);
  }
}

function TransformStreamTransformIfNeeded(transformStream) {
  // console.log('TransformStreamTransformIfNeeded()');

  if (transformStream._chunkPending === false) {
    return;
  }

  assert(transformStream._resolveWrite !== undefined);

  if (transformStream._transforming === true) {
    return;
  }

  if (transformStream._readableBackpressure === true) {
    return;
  }

  transformStream._transforming = true;

  const chunk = transformStream._chunk;
  transformStream._chunkPending = false;
  transformStream._chunk = undefined;

  try {
    if (transformStream._transformer.transform !== undefined) {
      transformStream._transformer.transform(
          chunk,
          TransformStreamChunkDone.bind(undefined, transformStream),
          transformStream._enqueueFunction,
          transformStream._closeFunction,
          transformStream._errorFunction);
    }
  } catch (e) {
    if (transformStream._errored === false) {
      TransformStreamErrorInternal(transformStream, e);
    }
  }
}

function TransformStreamStart(transformStream) {
  if (transformStream._transformer.start === undefined) {
    return;
  }

  // Thrown exception will be handled by TransformStreamSink.start()
  // method.
  transformStream._transformer.start(
      transformStream._enqueueFunction,
      transformStream._closeFunction,
      transformStream._errorFunction);
}

class TransformStreamSink {
  constructor(transformStream) {
    this._transformStream = transformStream;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._writableController = c;

    if (transformStream._readableController !== undefined) {
      TransformStreamStart(transformStream);
    }
  }

  write(chunk) {
    // console.log('TransformStreamSink.write()');

    const transformStream = this._transformStream;

    assert(transformStream._errored === false);

    assert(transformStream._chunkPending === false);
    assert(transformStream._chunk === undefined);

    assert(transformStream._resolveWrite === undefined);

    transformStream._chunkPending = true;
    transformStream._chunk = chunk;

    const promise = new Promise(resolve => {
      transformStream._resolveWrite = resolve;
    });

    TransformStreamTransformIfNeeded(transformStream);

    return promise;
  }

  abort() {
    const transformStream = this._transformStream;
    transformStream._writableDone = true;
    TransformStreamErrorInternal(transformStream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamSink.close()');

    const transformStream = this._transformStream;

    assert(transformStream._chunkPending === false);
    assert(transformStream._chunk === undefined);

    assert(transformStream._resolveWrite === undefined);

    assert(transformStream._transforming === false);

    // No control over the promise returned by writableStreamWriter.close(). Need it?

    transformStream._writableDone = true;

    if (transformStream._transformer.flush === undefined) {
      TransformStreamCloseReadable(transformStream);
    } else {
      try {
        transformStream._transformer.flush(
            transformStream._enqueueFunction,
            transformStream._closeFunction,
            transformStream._errorFunction);
      } catch (e) {
        if (transformStream._errored === false) {
          TransformStreamErrorInternal(transformStream, e);
          throw e;
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
    const transformStream = this._transformStream;

    transformStream._readableController = c;

    if (transformStream._writableController !== undefined) {
      TransformStreamStart(transformStream);
    }
  }

  pull() {
    this._transformStream._readableBackpressure = false;
    TransformStreamTransformIfNeeded(this._transformStream);
  }

  cancel() {
    const transformStream = this._transformStream;
    transformStream._readableClosed = true;
    TransformStreamErrorInternal(transformStream, new TypeError('Readable side canceled'));
  }
}

module.exports = class TransformStream {
  constructor(transformer) {
    if (transformer.start !== undefined && typeof transformer.start !== 'function') {
      throw new TypeError('start must be a function or undefined');
    }
    if (typeof transformer.transform !== 'function') {
      throw new TypeError('transform must be a function');
    }
    if (transformer.flush !== undefined && typeof transformer.flush !== 'function') {
      throw new TypeError('flush must be a function or undefined');
    }

    this._transformer = transformer;

    this._transforming = false;
    this._errored = false;

    this._writableController = undefined;
    this._readableController = undefined;

    this._writableDone = false;
    this._readableClosed = false;

    this._resolveWrite = undefined;

    this._chunkPending = false;
    this._chunk = undefined;

    this._enqueueFunction = TransformStreamEnqueueToReadable.bind(undefined, this);
    this._closeFunction = TransformStreamCloseReadable.bind(undefined, this);
    this._errorFunction = TransformStreamError.bind(undefined, this);

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
      this.writable = undefined;
      if (this._errored === false) {
        TransformStreamError(this, e);
        throw e;
      }
    }
  }
};
