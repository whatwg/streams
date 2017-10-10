'use strict';
const assert = require('better-assert');

// Calls to verbose() are purely for debugging the reference implementation and tests. They are not part of the standard
// and do not appear in the standard text.
const verbose = require('debug')('streams:transform-stream:verbose');
const { Call, InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } = require('./helpers.js');
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

    const readableType = transformer.readableType;

    if (readableType !== undefined) {
      throw new RangeError('Invalid readable type specified');
    }

    const writableType = transformer.writableType;

    if (writableType !== undefined) {
      throw new RangeError('Invalid writable type specified');
    }

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
  verbose('TransformStreamError()');

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
  verbose(`TransformStreamSetBackpressure() [backpressure = ${backpressure}]`);

  // Passes also when called during construction.
  assert(stream._backpressure !== backpressure);

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
  verbose('TransformStreamDefaultControllerTerminate()');

  const stream = controller._controlledTransformStream;
  const readableController = stream._readable._readableStreamController;

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === true) {
    ReadableStreamDefaultControllerClose(readableController);
  }

  WritableStreamDefaultControllerErrorIfNeeded(stream._writable._writableStreamController,
                                               new TypeError('TransformStream terminated'));
  if (stream._backpressure === true) {
    // Permit any pending write() or start() calls to complete.
    TransformStreamSetBackpressure(stream, false);
  }
}

function TransformStreamDefaultControllerEnqueue(controller, chunk) {
  verbose('TransformStreamDefaultControllerEnqueue()');

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
    assert(backpressure === true);
    TransformStreamSetBackpressure(stream, true);
  }
}

function TransformStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledTransformStream;

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
    verbose('TransformStreamDefaultSink.prototype.write()');

    const stream = this._ownerTransformStream;
    assert(stream._writable._state === 'writable');

    if (stream._backpressure === true) {
      const backpressureChangePromise = stream._backpressureChangePromise;
      assert(backpressureChangePromise !== undefined);
      return backpressureChangePromise
          .then(() => {
            const writable = stream._writable;
            const state = writable._state;
            if (state === 'erroring') {
              throw writable._storedError;
            }
            assert(state === 'writable');
            return TransformStreamDefaultSinkTransform(this, chunk);
          });
    }

    return TransformStreamDefaultSinkTransform(this, chunk);
  }

  abort() {
    // abort() is not called synchronously, so it is possible for abort() to be called when the stream is already
    // errored.
    const e = new TypeError('Writable side aborted');
    TransformStreamError(this._ownerTransformStream, e);
  }

  close() {
    verbose('TransformStreamDefaultSink.prototype.close()');

    const stream = this._ownerTransformStream;

    // stream._readable cannot change after construction, so caching it across a call to user code is safe.
    const readable = stream._readable;

    const flushPromise = PromiseInvokeOrNoop(stream._transformer, 'flush', [stream._transformStreamController]);
    // Return a promise that is fulfilled with undefined on success.
    return flushPromise.then(() => {
      if (readable._state === 'errored') {
        throw readable._storedError;
      }
      const readableController = readable._readableStreamController;
      if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === true) {
        ReadableStreamDefaultControllerClose(readableController);
      }
    }).catch(r => {
      TransformStreamError(stream, r);
      throw readable._storedError;
    });
  }
}

function TransformStreamDefaultSinkInvokeTransform(stream, chunk) {
  const controller = stream._transformStreamController;
  const transformer = stream._transformer;

  const method = transformer.transform; // can throw

  if (method === undefined) {
    TransformStreamDefaultControllerEnqueue(controller, chunk); // can throw
    return undefined;
  }

  return Call(method, transformer, [chunk, controller]); // can throw
}

function TransformStreamDefaultSinkTransform(sink, chunk) {
  verbose('TransformStreamDefaultSinkTransform()');

  const stream = sink._ownerTransformStream;

  assert(stream._readable._state !== 'errored');
  assert(stream._backpressure === false);

  let transformPromise;
  try {
    // TransformStreamDefaultSinkInvokeTransform is a separate operation to permit consolidating the abrupt completion
    // handling in one place in the text of the standard.
    const transformResult = TransformStreamDefaultSinkInvokeTransform(stream, chunk);
    transformPromise = Promise.resolve(transformResult);
  } catch (e) {
    transformPromise = Promise.reject(e);
  }

  return transformPromise.catch(e => {
    TransformStreamError(stream, e);
    throw e;
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
    verbose('TransformStreamDefaultSource.prototype.pull()');

    const stream = this._ownerTransformStream;

    // Invariant. Enforced by the promises returned by start() and pull().
    assert(stream._backpressure === true);

    assert(stream._backpressureChangePromise !== undefined);

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
