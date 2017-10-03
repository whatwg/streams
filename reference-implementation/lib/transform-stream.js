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
  constructor(transformer = {}, writableStrategy = undefined, { size, highWaterMark = 0 } = {}) {
    this._transformer = transformer;

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

    this._readable = new ReadableStream(source, { size, highWaterMark });

    const sink = new TransformStreamDefaultSink(this, startPromise);

    this._writable = new WritableStream(sink, writableStrategy);

    TransformStreamSetBackpressure(this, true);

    const startResult = InvokeOrNoop(transformer, 'start', [this._transformStreamController]);
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

// This is a no-op if both sides are already errored.
function TransformStreamError(stream, e) {
  // console.log('TransformStreamError()');

  WritableStreamDefaultControllerErrorIfNeeded(stream._writable._writableStreamController, e);
  if (stream._readable._state === 'readable') {
    ReadableStreamDefaultControllerError(stream._readable._readableStreamController, e);
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
    stream._backpressureChangePromise_resolve();
  }

  stream._backpressureChangePromise = new Promise(resolve => {
    stream._backpressureChangePromise_resolve = resolve;
  });

  stream._backpressure = backpressure;
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

    const readableController = this._controlledTransformStream._readable._readableStreamController;
    return ReadableStreamDefaultControllerGetDesiredSize(readableController);
  }

  enqueue(chunk) {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('enqueue');
    }

    TransformStreamDefaultControllerEnqueue(this, chunk);
  }

  terminate() {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('close');
    }

    TransformStreamDefaultControllerTerminate(this);
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

function TransformStreamDefaultControllerTerminate(controller) {
  // console.log('TransformStreamDefaultControllerTerminate()');

  const stream = controller._controlledTransformStream;
  const readableController = stream._readable._readableStreamController;
  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === false) {
    throw new TypeError('Readable side is not in a state that can be closed');
  }

  ReadableStreamDefaultControllerClose(readableController);
  WritableStreamDefaultControllerErrorIfNeeded(stream._writable._writableStreamController,
                                               new TypeError('TransformStream terminated'));
  if (stream._backpressure === true) {
    // Permit any pending write() or start() calls to complete.
    TransformStreamSetBackpressure(stream, false);
  }
}

function TransformStreamDefaultControllerEnqueue(controller, chunk) {
  // console.log('TransformStreamDefaultControllerEnqueue()');

  const stream = controller._controlledTransformStream;
  const readableController = stream._readable._readableStreamController;
  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === false) {
    throw new TypeError('Readable side is not in a state that permits enqueue');
  }

  // We throttle transformer.transform invocations based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamDefaultControllerEnqueue() calls.

  try {
    ReadableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    TransformStreamError(stream, e);

    throw stream._readable._storedError;
  }

  const backpressure = ReadableStreamDefaultControllerHasBackpressure(readableController);
  if (backpressure !== stream._backpressure) {
    assert(backpressure === true, 'backpressure is *true*');
    TransformStreamSetBackpressure(stream, true);
  }
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

  start() {
    return this._startPromise;
  }

  write(chunk) {
    // console.log('TransformStreamDefaultSink.write()');

    const stream = this._ownerTransformStream;
    assert(stream._writable._state === 'writable', 'stream.[[writable]].[[state]] is `"writable"`');

    if (stream._backpressure === true) {
      const backpressureChangePromise = stream._backpressureChangePromise;
      assert(backpressureChangePromise !== undefined, '_backpressureChangePromise should have been initialized');
      return backpressureChangePromise
          .then(() => {
            const writable = stream._writable;
            const state = writable._state;
            if (state === 'erroring') {
              return Promise.reject(writable._storedError);
            }
            assert(state === 'writable', 'state is `"writable"`');
            return TransformStreamDefaultSinkTransform(this, chunk);
          });
    }

    return TransformStreamDefaultSinkTransform(this, chunk);
  }

  abort() {
    // abort() is not called synchronously, so it is possible for abort() to be called when the stream is already
    // errored.
    TransformStreamError(this._ownerTransformStream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamDefaultSink.close()');

    const stream = this._ownerTransformStream;

    // stream._readable cannot change after construction, so caching it across a call to user code is safe.
    const readable = stream._readable;

    const flushPromise = PromiseInvokeOrNoop(stream._transformer, 'flush', [stream._transformStreamController]);
    // Return a promise that is fulfilled with undefined on success.
    return flushPromise.then(() => {
      if (readable._state === 'errored') {
        return Promise.reject(readable._storedError);
      }
      const readableController = readable._readableStreamController;
      if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === true) {
        ReadableStreamDefaultControllerClose(readableController);
      }
      return Promise.resolve();
    }).catch(r => {
      TransformStreamError(stream, r);
      return Promise.reject(readable._storedError);
    });
  }
}

function TransformStreamDefaultSinkDefaultTransform(chunk, controller) {
  TransformStreamDefaultControllerEnqueue(controller, chunk);
  return Promise.resolve();
}

function TransformStreamDefaultSinkTransform(sink, chunk) {
  // console.log('TransformStreamDefaultSinkTransform()');

  const stream = sink._ownerTransformStream;

  assert(stream._readable._state !== 'errored');
  assert(stream._backpressure === false);

  const controller = stream._transformStreamController;

  const transformPromise = PromiseInvokeOrPerformFallback(stream._transformer, 'transform', [chunk, controller],
                             TransformStreamDefaultSinkDefaultTransform, [chunk, controller]);

  return transformPromise.then(
      undefined,
      e => {
        TransformStreamError(stream, e);
        return Promise.reject(e);
      });
}

// Class TransformStreamDefaultSource

class TransformStreamDefaultSource {
  constructor(stream, startPromise) {
    this._ownerTransformStream = stream;
    this._startPromise = startPromise;
  }

  start() {
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
    TransformStreamError(this._ownerTransformStream, reason);
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
