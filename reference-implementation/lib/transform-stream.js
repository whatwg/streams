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

    const stream = this;
    const startResult = InvokeOrNoop(transformer, 'start',
                          [stream._transformStreamController]);
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

function TransformStreamCloseReadable(stream) {
  // console.log('TransformStreamCloseReadable()');

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(stream._readableController) === false) {
    throw new TypeError('Readable side is not in a state that can be closed');
  }

  TransformStreamCloseReadableInternal(stream);
}

function TransformStreamCloseReadableInternal(stream) {
  assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(stream._readableController) === true);

  ReadableStreamDefaultControllerClose(stream._readableController);
}

function TransformStreamDefaultTransform(chunk, controller) {
  const stream = controller._controlledTransformStream;
  TransformStreamEnqueueToReadable(stream, chunk);
  return Promise.resolve();
}

function TransformStreamEnqueueToReadable(stream, chunk) {
  // console.log('TransformStreamEnqueueToReadable()');

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(stream._readableController) === false) {
    throw new TypeError('Readable side is not in a state that permits enqueue');
  }

  // We throttle transformer.transform invocation based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamEnqueueToReadable() calls.

  const controller = stream._readableController;

  try {
    ReadableStreamDefaultControllerEnqueue(controller, chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    TransformStreamError(stream, e);

    throw stream._readable._storedError;
  }

  const backpressure = ReadableStreamDefaultControllerHasBackpressure(controller);
  if (backpressure !== stream._backpressure) {
    assert(backpressure === true, 'backpressure is *true*');
    TransformStreamSetBackpressure(stream, true);
  }
}

// This is a no-op if both sides are already errored.
function TransformStreamError(stream, e) {
  // console.log('TransformStreamError()');

  WritableStreamDefaultControllerErrorIfNeeded(stream._writableController, e);
  if (stream._readable._state === 'readable') {
    ReadableStreamDefaultControllerError(stream._readableController, e);
  }
  if (stream._backpressure === true) {
    // Pretend that pull() was called to permit any pending write() calls to complete. TransformStreamSetBackpressure()
    // cannot be called from enqueue() or pull() once the ReadableStream is errored, so this will will be the final time
    // _backpressure is set.
    TransformStreamSetBackpressure(stream, false);
  }
}

function TransformStreamSetBackpressure(stream, backpressure) {
  // console.log(`TransformStreamSetBackpressure(${backpressure})`);

  // Passes also when called during construction.
  assert(stream._backpressure !== backpressure,
         'TransformStreamSetBackpressure() should be called only when backpressure is changed');

  if (stream._backpressureChangePromise !== undefined) {
    // The fulfillment value is just for a sanity check.
    stream._backpressureChangePromise_resolve(backpressure);
  }

  stream._backpressureChangePromise = new Promise(resolve => {
    stream._backpressureChangePromise_resolve = resolve;
  });

  stream._backpressureChangePromise.then(resolution => {
    assert(resolution !== backpressure,
           '_backpressureChangePromise should be fulfilled only when backpressure is changed');
  });

  stream._backpressure = backpressure;
}

function TransformStreamTransform(stream, chunk) {
  // console.log('TransformStreamTransform()');

  assert(stream._readable._state !== 'errored');
  assert(stream._backpressure === false);

  const transformer = stream._transformer;
  const controller = stream._transformStreamController;

  const transformPromise = PromiseInvokeOrPerformFallback(transformer, 'transform', [chunk, controller],
                             TransformStreamDefaultTransform, [chunk, controller]);

  return transformPromise.then(
      undefined,
      e => {
        TransformStreamError(stream, e);
        return Promise.reject(e);
      });
}

// Class TransformStreamDefaultController

class TransformStreamDefaultController {
  constructor(stream) {
    if (IsTransformStream(stream) === false) {
      throw new TypeError('TransformStreamDefaultController can only be ' +
                          'constructed with a TransformStream instance');
    }

    if (stream._transformStreamController !== undefined) {
      throw new TypeError('TransformStreamDefaultController instances can ' +
                          'only be created by the TransformStream constructor');
    }

    this._controlledTransformStream = stream;
  }

  get desiredSize() {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('desiredSize');
    }

    const stream = this._controlledTransformStream;
    const readableController = stream._readableController;

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
  const stream = controller._controlledTransformStream;

  assert(stream._readable._state === 'readable', 'stream.[[readable]].[[state]] is "readable"');

  TransformStreamError(stream, e);
}

// Class TransformStreamDefaultSink

class TransformStreamDefaultSink {
  constructor(stream, startPromise) {
    this._ownerTransformStream = stream;
    this._startPromise = startPromise;
  }

  start(c) {
    const stream = this._ownerTransformStream;

    stream._writableController = c;

    return this._startPromise;
  }

  write(chunk) {
    // console.log('TransformStreamDefaultSink.write()');

    const stream = this._ownerTransformStream;
    assert(stream._writable._state === 'writable', 'stream.[[writable]].[[state]] is `"writable"`');

    if (stream._backpressure === true) {
      assert(stream._backpressureChangePromise !== undefined,
             '_backpressureChangePromise should have been initialized');
      return stream._backpressureChangePromise
          .then(() => {
            const writable = stream._writable;
            const state = writable._state;
            if (state === 'erroring') {
              return Promise.reject(writable._storedError);
            }
            assert(state === 'writable', 'state is `"writable"`');
            return TransformStreamTransform(stream, chunk);
          });
    }

    return TransformStreamTransform(stream, chunk);
  }

  abort() {
    const stream = this._ownerTransformStream;
    // abort() is not called synchronously, so it is possible for abort() to be called when the stream is already
    // errored.
    TransformStreamError(stream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamDefaultSink.close()');

    const stream = this._ownerTransformStream;

    const flushPromise = PromiseInvokeOrNoop(stream._transformer,
                         'flush', [stream._transformStreamController]);
    // Return a promise that is fulfilled with undefined on success.
    return flushPromise.then(() => {
      if (stream._readable._state === 'errored') {
        return Promise.reject(stream._readable._storedError);
      }
      if (ReadableStreamDefaultControllerCanCloseOrEnqueue(stream._readableController) === true) {
        TransformStreamCloseReadableInternal(stream);
      }
      return Promise.resolve();
    }).catch(r => {
      TransformStreamError(stream, r);
      return Promise.reject(stream._readable._storedError);
    });
  }
}

// Class TransformStreamDefaultSource

class TransformStreamDefaultSource {
  constructor(stream, startPromise) {
    this._ownerTransformStream = stream;
    this._startPromise = startPromise;
  }

  start(c) {
    const stream = this._ownerTransformStream;

    stream._readableController = c;

    return this._startPromise;
  }

  pull() {
    // console.log('TransformStreamDefaultSource.pull()');

    const stream = this._ownerTransformStream;

    // Invariant. Enforced by the promises returned by start() and pull().
    assert(stream._backpressure === true, 'pull() should be never called while _backpressure is false');

    assert(stream._backpressureChangePromise !== undefined,
           '_backpressureChangePromise should have been initialized');

    TransformStreamSetBackpressure(stream, false);

    // Prevent the next pull() call until there is backpressure.
    return stream._backpressureChangePromise;
  }

  cancel(reason) {
    const stream = this._ownerTransformStream;
    TransformStreamError(stream, reason);
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
