'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrPerformFallback, PromiseInvokeOrNoop, typeIsObject } = require('./helpers.js');
const { ReadableStream, ReadableStreamDefaultControllerClose,
        ReadableStreamDefaultControllerEnqueue, ReadableStreamDefaultControllerError,
        ReadableStreamDefaultControllerGetDesiredSize,
        ReadableStreamDefaultControllerHasBackpressure } = require('./readable-stream.js');
const { WritableStream, WritableStreamDefaultControllerError } = require('./writable-stream.js');

// Class TransformStream

class TransformStream {
  constructor(transformer = {}, writableStrategy = undefined, readableStrategy = undefined) {
    this._transformer = transformer;

    this._transforming = false;
    this._errored = false;
    this._storedError = undefined;

    this._writableController = undefined;
    this._readableController = undefined;
    this._transformStreamController = undefined;

    this._writableDone = false;
    this._readableClosed = false;

    this._backpressure = undefined;
    this._backpressureChangePromise = undefined;
    this._backpressureChangePromise_resolve = undefined;

    this._transformStreamController = new TransformStreamDefaultController(this);

    let startPromise_resolve;
    const startPromise = new Promise(resolve => {
      startPromise_resolve = resolve;
    });

    const source = new TransformStreamDefaultSource(this, startPromise);

    this._readable = new ReadableStream(source, readableStrategy);

    const sink = new TransformStreamDefaultSink(this, startPromise);

    this._writable = new WritableStream(sink, writableStrategy);

    assert(this._writableController !== undefined);
    assert(this._readableController !== undefined);

    TransformStreamSetBackpressure(this, true);

    const transformStream = this;
    const startResult = InvokeOrNoop(transformer, 'start',
                          [transformStream._transformStreamController]);
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
    if (IsTransformStream(this) === false) {
      throw streamBrandCheckException('readable');
    }

    return this._readable;
  }

  get writable() {
    if (IsTransformStream(this) === false) {
      throw streamBrandCheckException('writable');
    }

    return this._writable;
  }
}

// Transform Stream Abstract Operations

function IsTransformStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_transformStreamController')) {
    return false;
  }

  return true;
}

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

function TransformStreamCloseReadableInternal(transformStream) {
  assert(transformStream._errored === false);
  assert(transformStream._readableClosed === false);

  try {
    ReadableStreamDefaultControllerClose(transformStream._readableController);
  } catch (e) {
    assert(false);
  }

  transformStream._readableClosed = true;
}

function TransformStreamDefaultTransform(chunk, transformStreamController) {
  const transformStream = transformStreamController._controlledTransformStream;
  TransformStreamEnqueueToReadable(transformStream, chunk);
  return Promise.resolve();
}

function TransformStreamEnqueueToReadable(transformStream, chunk) {
  // console.log('TransformStreamEnqueueToReadable()');

  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  if (transformStream._readableClosed === true) {
    throw new TypeError('Readable side is already closed');
  }

  // We throttle transformer.transform invocation based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamEnqueueToReadable() calls.

  const controller = transformStream._readableController;

  try {
    ReadableStreamDefaultControllerEnqueue(controller, chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    // The ReadableStream has already errored itself.
    transformStream._readableClosed = true;
    TransformStreamErrorIfNeeded(transformStream, e);

    throw transformStream._storedError;
  }

  const backpressure = ReadableStreamDefaultControllerHasBackpressure(controller);
  if (backpressure !== transformStream._backpressure) {
    TransformStreamSetBackpressure(transformStream, backpressure);
  }
}

function TransformStreamError(transformStream, e) {
  if (transformStream._errored === true) {
    throw new TypeError('TransformStream is already errored');
  }

  TransformStreamErrorInternal(transformStream, e);
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
    WritableStreamDefaultControllerError(transformStream._writableController, e);
  }
  if (transformStream._readableClosed === false) {
    ReadableStreamDefaultControllerError(transformStream._readableController, e);
  }
  if (transformStream._backpressure === true) {
    // Pretend that pull() was called to permit any pending write() or start() calls to complete.
    // TransformStreamSetBackpressure() cannot be called from enqueue() or pull() once the ReadableStream is errored,
    // so this will will be the final time _backpressure is set.
    TransformStreamSetBackpressure(transformStream, false);
  }
}

// Used for preventing the next write() call on TransformStreamDefaultSink until there
// is no longer backpressure.
function TransformStreamReadableReadyPromise(transformStream) {
  assert(transformStream._backpressureChangePromise !== undefined,
         '_backpressureChangePromise should have been initialized');

  if (transformStream._backpressure === false) {
    return Promise.resolve();
  }

  assert(transformStream._backpressure === true, '_backpressure should have been initialized');

  return transformStream._backpressureChangePromise;
}

function TransformStreamSetBackpressure(transformStream, backpressure) {
  // console.log(`TransformStreamSetBackpressure(${backpressure})`);

  // Passes also when called during construction.
  assert(transformStream._backpressure !== backpressure,
         'TransformStreamSetBackpressure() should be called only when backpressure is changed');

  if (transformStream._backpressureChangePromise !== undefined) {
    // The fulfillment value is just for a sanity check.
    transformStream._backpressureChangePromise_resolve(backpressure);
  }

  transformStream._backpressureChangePromise = new Promise(resolve => {
    transformStream._backpressureChangePromise_resolve = resolve;
  });

  transformStream._backpressureChangePromise.then(resolution => {
    assert(resolution !== backpressure,
           '_backpressureChangePromise should be fulfilled only when backpressure is changed');
  });

  transformStream._backpressure = backpressure;
}

function TransformStreamTransform(transformStream, chunk) {
  // console.log('TransformStreamTransform()');

  assert(transformStream._errored === false);
  assert(transformStream._transforming === false);
  assert(transformStream._backpressure === false);

  transformStream._transforming = true;

  const transformer = transformStream._transformer;
  const controller = transformStream._transformStreamController;

  const transformPromise = PromiseInvokeOrPerformFallback(transformer, 'transform', [chunk, controller],
                             TransformStreamDefaultTransform, [chunk, controller]);

  return transformPromise.then(
    () => {
      transformStream._transforming = false;

      return TransformStreamReadableReadyPromise(transformStream);
    },
    e => {
      TransformStreamErrorIfNeeded(transformStream, e);
      return Promise.reject(e);
    });
}

// Class TransformStreamDefaultController

class TransformStreamDefaultController {
  constructor(transformStream) {
    if (IsTransformStream(transformStream) === false) {
      throw new TypeError('TransformStreamDefaultController can only be ' +
                          'constructed with a TransformStream instance');
    }

    if (transformStream._transformStreamController !== undefined) {
      throw new TypeError('TransformStreamDefaultController instances can ' +
                          'only be created by the TransformStream constructor');
    }

    this._controlledTransformStream = transformStream;
  }

  get desiredSize() {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('desiredSize');
    }

    const transformStream = this._controlledTransformStream;
    const readableController = transformStream._readableController;

    return ReadableStreamDefaultControllerGetDesiredSize(readableController);
  }

  enqueue(chunk) {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('enqueue');
    }

    TransformStreamEnqueueToReadable(this._controlledTransformStream, chunk);
  }

  close() {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('close');
    }

    TransformStreamCloseReadable(this._controlledTransformStream);
  }

  error(reason) {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('error');
    }

    TransformStreamError(this._controlledTransformStream, reason);
  }
}

// Writable Stream Default Controller Abstract Operations

function IsTransformStreamDefaultController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledTransformStream')) {
    return false;
  }

  return true;
}

// Class TransformStreamDefaultSink

class TransformStreamDefaultSink {
  constructor(transformStream, startPromise) {
    this._transformStream = transformStream;
    this._startPromise = startPromise;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._writableController = c;

    return this._startPromise.then(() => TransformStreamReadableReadyPromise(transformStream));
  }

  write(chunk) {
    // console.log('TransformStreamDefaultSink.write()');

    const transformStream = this._transformStream;

    return TransformStreamTransform(transformStream, chunk);
  }

  abort() {
    const transformStream = this._transformStream;
    transformStream._writableDone = true;
    TransformStreamErrorInternal(transformStream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamDefaultSink.close()');

    const transformStream = this._transformStream;

    assert(transformStream._transforming === false);

    transformStream._writableDone = true;

    const flushPromise = PromiseInvokeOrNoop(transformStream._transformer,
                         'flush', [transformStream._transformStreamController]);
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

// Class TransformStreamDefaultSource

class TransformStreamDefaultSource {
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
    // console.log('TransformStreamDefaultSource.pull()');

    const transformStream = this._transformStream;

    // Invariant. Enforced by the promises returned by start() and pull().
    assert(transformStream._backpressure === true, 'pull() should be never called while _backpressure is false');

    assert(transformStream._backpressureChangePromise !== undefined,
           '_backpressureChangePromise should have been initialized');

    TransformStreamSetBackpressure(transformStream, false);

    // Prevent the next pull() call until there is backpressure.
    return transformStream._backpressureChangePromise;
  }

  cancel(reason) {
    const transformStream = this._transformStream;
    transformStream._readableClosed = true;
    TransformStreamErrorInternal(transformStream, reason);
  }
}

module.exports = { TransformStream };

// Helper functions for the TransformStreamDefaultController.

function defaultControllerBrandCheckException(name) {
  return new TypeError(
    `TransformStreamDefaultController.prototype.${name} can only be used on a TransformStreamDefaultController`);
}

// Helper functions for the TransformStream.

function streamBrandCheckException(name) {
  return new TypeError(
    `TransformStream.prototype.${name} can only be used on a TransformStream`);
}
