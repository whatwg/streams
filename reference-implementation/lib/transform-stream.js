'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrPerformFallback, PromiseInvokeOrNoop, typeIsObject } = require('./helpers.js');
const { ReadableStream, ReadableStreamDefaultControllerClose, ReadableStreamDefaultControllerEnqueue,
        ReadableStreamDefaultControllerError, ReadableStreamDefaultControllerGetDesiredSize,
        ReadableStreamDefaultControllerHasBackpressure,
        ReadableStreamDefaultControllerCanCloseOrEnqueue } = require('./readable-stream.js');
const { WritableStream, WritableStreamDefaultControllerErrorIfNeeded } = require('./writable-stream.js');

// Class TransformStream

class TransformStream {
  constructor(transformer = {}, writableStrategy = undefined, readableStrategy = undefined) {
    this._transformer = transformer;

    this._writableController = undefined;
    this._readableController = undefined;
    this._transformStreamController = undefined;

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

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(transformStream._readableController) === false) {
    throw new TypeError('Readable side is not in a state that can be closed');
  }

  TransformStreamCloseReadableInternal(transformStream);
}

function TransformStreamCloseReadableInternal(transformStream) {
  assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(transformStream._readableController) === true);

  ReadableStreamDefaultControllerClose(transformStream._readableController);
}

function TransformStreamDefaultTransform(chunk, transformStreamController) {
  const transformStream = transformStreamController._controlledTransformStream;
  TransformStreamEnqueueToReadable(transformStream, chunk);
  return Promise.resolve();
}

function TransformStreamEnqueueToReadable(transformStream, chunk) {
  // console.log('TransformStreamEnqueueToReadable()');

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(transformStream._readableController) === false) {
    throw new TypeError('Readable side is not in a state that permits enqueue');
  }

  // We throttle transformer.transform invocation based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamEnqueueToReadable() calls.

  const controller = transformStream._readableController;

  try {
    ReadableStreamDefaultControllerEnqueue(controller, chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    TransformStreamError(transformStream, e);

    throw transformStream._readable._storedError;
  }

  const backpressure = ReadableStreamDefaultControllerHasBackpressure(controller);
  if (backpressure !== transformStream._backpressure) {
    TransformStreamSetBackpressure(transformStream, backpressure);
  }
}

// This is a no-op if both sides are already errored.
function TransformStreamError(transformStream, e) {
  // console.log('TransformStreamError()');

  WritableStreamDefaultControllerErrorIfNeeded(transformStream._writableController, e);
  if (transformStream._readable._state === 'readable') {
    ReadableStreamDefaultControllerError(transformStream._readableController, e);
  }
  if (transformStream._backpressure === true) {
    // Pretend that pull() was called to permit any pending write() or start() calls to complete.
    // TransformStreamSetBackpressure() cannot be called from enqueue() or pull() once the ReadableStream is errored,
    // so this will will be the final time _backpressure is set.
    TransformStreamSetBackpressure(transformStream, false);
  }
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

  assert(transformStream._readable._state !== 'errored');
  assert(transformStream._backpressure === false);

  const transformer = transformStream._transformer;
  const controller = transformStream._transformStreamController;

  const transformPromise = PromiseInvokeOrPerformFallback(transformer, 'transform', [chunk, controller],
                             TransformStreamDefaultTransform, [chunk, controller]);

  return transformPromise.then(
      undefined,
      e => {
        TransformStreamError(transformStream, e);
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

    if (this._controlledTransformStream._readable._state !== 'readable') {
      throw new TypeError('TransformStream is not in a state that can be errored');
    }

    TransformStreamDefaultControllerError(this, reason);
  }
}

// Transform Stream Default Controller Abstract Operations

function IsTransformStreamDefaultController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledTransformStream')) {
    return false;
  }

  return true;
}

function TransformStreamDefaultControllerError(controller, e) {
  const transformStream = controller._controlledTransformStream;

  assert(transformStream._readable._state === 'readable', 'stream.[[readable]].[[state]] is "readable"');

  TransformStreamError(transformStream, e);
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

    return this._startPromise;
  }

  write(chunk) {
    // console.log('TransformStreamDefaultSink.write()');

    const transformStream = this._transformStream;

    if (transformStream._backpressure === true) {
      return transformStream._backpressureChangePromise
          .then(() => {
            if (transformStream._errored === true) {
              return Promise.reject(transformStream._storedError);
            }
            return TransformStreamTransform(transformStream, chunk);
          });
    }

    return TransformStreamTransform(transformStream, chunk);
  }

  abort() {
    const transformStream = this._transformStream;
    // abort() is not called synchronously, so it is possible for abort() to be called when the stream is already
    // errored.
    TransformStreamError(transformStream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamDefaultSink.close()');

    const transformStream = this._transformStream;

    const flushPromise = PromiseInvokeOrNoop(transformStream._transformer,
                         'flush', [transformStream._transformStreamController]);
    // Return a promise that is fulfilled with undefined on success.
    return flushPromise.then(() => {
      if (transformStream._readable._state === 'errored') {
        return Promise.reject(transformStream._readable._storedError);
      }
      if (ReadableStreamDefaultControllerCanCloseOrEnqueue(transformStream._readableController) === true) {
        TransformStreamCloseReadableInternal(transformStream);
      }
      return Promise.resolve();
    }).catch(r => {
      TransformStreamError(transformStream, r);
      return Promise.reject(transformStream._readable._storedError);
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
    TransformStreamError(transformStream, reason);
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
