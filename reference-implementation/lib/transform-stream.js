'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrNoop } = require('./helpers.js');
const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');

// Methods on the transform stream controller object

function TransformStreamCloseReadable(transformStream) {
  // console.log('TransformStreamCloseReadable()');

  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  TransformStreamCloseReadableInternal(transformStream);
}

function TransformStreamEnqueueToReadable(transformStream, chunk) {
  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  // We throttle transformer.transform invocation based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamEnqueueToReadable() calls.

  const controller = transformStream._readableController;

  transformStream._readableBackpressure = true;

  try {
    controller.enqueue(chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    // The ReadableStream has already errored itself.
    transformStream._readableClosed = true;
    TransformStreamErrorIfNeeded(transformStream, e);

    throw transformStream._storedError;
  }

  const backpressure = controller.desiredSize <= 0;

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

// Abstract operations.

function TransformStreamCloseReadableInternal(transformStream) {
  assert(transformStream._errored === false);
  assert(transformStream._readableClosed === false);

  try {
    transformStream._readableController.close();
  } catch (e) {
    assert(false);
  }

  transformStream._readableClosed = true;
}

function TransformStreamResolveWrite(transformStream) {
  if (transformStream._errored === true) {
    return;
  }

  assert(transformStream._transforming === true);

  assert(transformStream._resolveWrite !== undefined);
  assert(transformStream._rejectWrite !== undefined);

  transformStream._transforming = false;

  transformStream._resolveWrite(undefined);
  transformStream._resolveWrite = undefined;
  transformStream._rejectWrite = undefined;

  TransformStreamTransformIfNeeded(transformStream);
}

function TransformStreamErrorIfNeeded(transformStream, e) {
  if (transformStream._errored === false) {
    TransformStreamErrorInternal(transformStream, e);
  }
}

function TransformStreamErrorInternal(transformStream, e) {
  // console.log('TransformStreamErrorInternal()');

  assert(transformStream._errored === false);

  transformStream._errored = true;
  transformStream._storedError = e;

  if (transformStream._writableDone === false) {
    transformStream._writableController.error(e);
  }
  if (transformStream._readableClosed === false) {
    transformStream._readableController.error(e);
  }

  transformStream._chunk = undefined;

  if (transformStream._rejectWriter !== undefined) {
    transformStream._rejectWriter(e);
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

  const transformPromise = PromiseInvokeOrNoop(transformStream._transformer,
                             'transform', [chunk, transformStream._controller]);

  transformPromise.then(() => TransformStreamResolveWrite(transformStream),
                     e => TransformStreamErrorIfNeeded(transformStream, e));
}

class TransformStreamSink {
  constructor(transformStream, startPromise) {
    this._transformStream = transformStream;
    this._startPromise = startPromise;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._writableController = c;

    return this._startPromise;
  }

  write(chunk) {
    // console.log('TransformStreamSink.write()');

    const transformStream = this._transformStream;

    assert(transformStream._errored === false);

    assert(transformStream._chunkPending === false);
    assert(transformStream._chunk === undefined);

    assert(transformStream._resolveWrite === undefined);
    assert(transformStream._rejectWrite === undefined);

    transformStream._chunkPending = true;
    transformStream._chunk = chunk;

    const promise = new Promise(resolve => {
      transformStream._resolveWrite = resolve;
      transformStream._rejectWrite = resolve;
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
    assert(transformStream._rejectWrite === undefined);

    assert(transformStream._transforming === false);

    transformStream._writableDone = true;

    const flushPromise = PromiseInvokeOrNoop(transformStream._transformer, 'flush', [transformStream._controller]);
    // Return a promise that is fulfilled with undefined on success.
    return flushPromise.then(() => {
      if (transformStream._errored === true) {
        return Promise.reject(transformStream._storedError);
      }
      if (transformStream._readableClosed === false) {
        TransformStreamCloseReadableInternal(transformStream);
      }
      return Promise.resolve();
    }).catch(r => {
      TransformStreamErrorIfNeeded(transformStream, r);
      return Promise.reject(transformStream._storedError);
    });
  }
}

class TransformStreamSource {
  constructor(transformStream, startPromise) {
    this._transformStream = transformStream;
    this._startPromise = startPromise;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._readableController = c;

    return this._startPromise;
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

class TransformStreamDefaultController {
  constructor(transformStream) {
    this._controlledTransformStream = transformStream;
  }

  enqueue(chunk) {
    TransformStreamEnqueueToReadable(this._controlledTransformStream, chunk);
  }

  close() {
    TransformStreamCloseReadable(this._controlledTransformStream);
  }

  error(reason) {
    TransformStreamError(this._controlledTransformStream, reason);
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
    this._storedError = undefined;

    this._writableController = undefined;
    this._readableController = undefined;

    this._writableDone = false;
    this._readableClosed = false;

    this._resolveWrite = undefined;
    this._rejectWrite = undefined;

    this._chunkPending = false;
    this._chunk = undefined;

    this._controller = new TransformStreamDefaultController(this);

    let startPromise_resolve;
    const startPromise = new Promise(resolve => {
      startPromise_resolve = resolve;
    });

    const sink = new TransformStreamSink(this, startPromise);

    this._writable = new WritableStream(sink, transformer.writableStrategy);

    const source = new TransformStreamSource(this, startPromise);

    this._readable = new ReadableStream(source, transformer.readableStrategy);

    assert(this._writableController !== undefined);
    assert(this._readableController !== undefined);

    const transformStream = this;
    const startResult = InvokeOrNoop(transformer, 'start', [transformStream._controller]);
    startPromise_resolve(startResult);
    startPromise.catch(e => {
      // The underlyingSink and underlyingSource will error the readable and writable ends on their own.
      if (transformStream._errored === false) {
        transformStream._errored = true;
        transformStream._storedError = e;
      }
    });
  }

  get readable() {
    return this._readable;
  }

  get writable() {
    return this._writable;
  }
};
