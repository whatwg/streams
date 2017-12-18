'use strict';
const assert = require('better-assert');

// Calls to verbose() are purely for debugging the reference implementation and tests. They are not part of the standard
// and do not appear in the standard text.
const verbose = require('debug')('streams:transform-stream:verbose');
const { InvokeOrNoop, CreateAlgorithmFromUnderlyingMethod, PromiseCall, typeIsObject,
        ValidateAndNormalizeHighWaterMark, IsNonNegativeNumber,
        MakeSizeAlgorithmFromSizeFunction } = require('./helpers.js');
const { CreateReadableStream, ReadableStreamDefaultControllerClose, ReadableStreamDefaultControllerEnqueue,
        ReadableStreamDefaultControllerError, ReadableStreamDefaultControllerGetDesiredSize,
        ReadableStreamDefaultControllerHasBackpressure,
        ReadableStreamDefaultControllerCanCloseOrEnqueue } = require('./readable-stream.js');
const { CreateWritableStream, WritableStreamDefaultControllerErrorIfNeeded } = require('./writable-stream.js');

// Class TransformStream

class TransformStream {
  constructor(transformer = {}, writableStrategy = {}, readableStrategy = {}) {
    const readableType = transformer.readableType;

    if (readableType !== undefined) {
      throw new RangeError('Invalid readable type specified');
    }

    const writableType = transformer.writableType;

    if (writableType !== undefined) {
      throw new RangeError('Invalid writable type specified');
    }

    const writableSizeFunction = writableStrategy.size;
    const writableSizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(writableSizeFunction);
    let writableHighWaterMark = writableStrategy.highWaterMark;
    if (writableHighWaterMark === undefined) {
      writableHighWaterMark = 1;
    }
    writableHighWaterMark = ValidateAndNormalizeHighWaterMark(writableHighWaterMark);

    const readableSizeFunction = readableStrategy.size;
    const readableSizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(readableSizeFunction);
    let readableHighWaterMark = readableStrategy.highWaterMark;
    if (readableHighWaterMark === undefined) {
      readableHighWaterMark = 0;
    }
    readableHighWaterMark = ValidateAndNormalizeHighWaterMark(readableHighWaterMark);

    let startPromise_resolve;
    const startPromise = new Promise(resolve => {
      startPromise_resolve = resolve;
    });

    InitializeTransformStream(this, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark,
                              readableSizeAlgorithm);
    SetUpTransformStreamDefaultControllerFromTransformer(this, transformer);

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

function CreateTransformStream(startAlgorithm, transformAlgorithm, flushAlgorithm, writableHighWaterMark = 1,
                               writableSizeAlgorithm = () => 1, readableHighWaterMark = 0,
                               readableSizeAlgorithm = () => 1) {
  assert(IsNonNegativeNumber(writableHighWaterMark));
  assert(IsNonNegativeNumber(readableHighWaterMark));

  const stream = Object.create(TransformStream.prototype);

  let startPromise_resolve;
  const startPromise = new Promise(resolve => {
    startPromise_resolve = resolve;
  });

  InitializeTransformStream(stream, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark,
                            readableSizeAlgorithm);

  const controller = Object.create(TransformStreamDefaultController.prototype);

  SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);

  const startResult = startAlgorithm();
  startPromise_resolve(startResult);
  return stream;
}

function InitializeTransformStream(stream, startPromise, writableHighWaterMark, writableSizeAlgorithm,
                                   readableHighWaterMark, readableSizeAlgorithm) {
  function startAlgorithm() {
    return startPromise;
  }

  function writeAlgorithm(chunk) {
    return TransformStreamDefaultSinkWriteAlgorithm(stream, chunk);
  }

  function abortAlgorithm() {
    return TransformStreamDefaultSinkAbortAlgorithm(stream);
  }

  function closeAlgorithm() {
    return TransformStreamDefaultSinkCloseAlgorithm(stream);
  }

  stream._writable = CreateWritableStream(startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm,
                                          writableHighWaterMark, writableSizeAlgorithm);

  function pullAlgorithm() {
    return TransformStreamDefaultSourcePullAlgorithm(stream);
  }

  function cancelAlgorithm(reason) {
    TransformStreamErrorWritableAndUnblockWrite(stream, reason);
    return Promise.resolve();
  }

  stream._readable = CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, readableHighWaterMark,
                                          readableSizeAlgorithm);

  // The [[backpressure]] slot is set to undefined so that it can be initialised by TransformStreamSetBackpressure.
  stream._backpressure = undefined;
  stream._backpressureChangePromise = undefined;
  stream._backpressureChangePromise_resolve = undefined;
  TransformStreamSetBackpressure(stream, true);

  // Used by IsWritableStream() which is called by SetUpTransformStreamDefaultController().
  stream._transformStreamController = undefined;
}

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

  if (stream._readable._state === 'readable') {
    ReadableStreamDefaultControllerError(stream._readable._readableStreamController, e);
  }
  TransformStreamErrorWritableAndUnblockWrite(stream, e);
}

function TransformStreamErrorWritableAndUnblockWrite(stream, e) {
  WritableStreamDefaultControllerErrorIfNeeded(stream._writable._writableStreamController, e);
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
  constructor() {
    throw new TypeError('TransformStreamDefaultController instances cannot be created directly');
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

  error(reason) {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('error');
    }

    TransformStreamDefaultControllerError(this, reason);
  }

  terminate() {
    if (IsTransformStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('terminate');
    }

    TransformStreamDefaultControllerTerminate(this);
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

function SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm) {
  assert(IsTransformStream(stream) === true);
  assert(stream._transformStreamController === undefined);

  controller._controlledTransformStream = stream;
  stream._transformStreamController = controller;

  controller._transformAlgorithm = transformAlgorithm;
  controller._flushAlgorithm = flushAlgorithm;
}

function SetUpTransformStreamDefaultControllerFromTransformer(stream, transformer) {
  assert(transformer !== undefined);

  const controller = Object.create(TransformStreamDefaultController.prototype);

  let transformAlgorithm = chunk => {
    try {
      TransformStreamDefaultControllerEnqueue(controller, chunk);
      return Promise.resolve();
    } catch (transformResultE) {
      return Promise.reject(transformResultE);
    }
  };
  const transformMethod = transformer.transform;
  if (transformMethod !== undefined) {
    if (typeof transformMethod !== 'function') {
      throw new TypeError('transform is not a method');
    }
    transformAlgorithm = chunk => {
      const transformPromise = PromiseCall(transformMethod, transformer, [chunk, controller]);
      return transformPromise.catch(e => {
        TransformStreamError(stream, e);
        throw e;
      });
    };
  }

  const flushAlgorithm = CreateAlgorithmFromUnderlyingMethod(transformer, 'flush', 0, [controller]);

  SetUpTransformStreamDefaultController(stream, controller, transformAlgorithm, flushAlgorithm);
}

function TransformStreamDefaultControllerEnqueue(controller, chunk) {
  verbose('TransformStreamDefaultControllerEnqueue()');

  const stream = controller._controlledTransformStream;
  const readableController = stream._readable._readableStreamController;
  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === false) {
    throw new TypeError('Readable side is not in a state that permits enqueue');
  }

  // We throttle transform invocations based on the backpressure of the ReadableStream, but we still
  // accept TransformStreamDefaultControllerEnqueue() calls.

  try {
    ReadableStreamDefaultControllerEnqueue(readableController, chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    TransformStreamErrorWritableAndUnblockWrite(stream, e);

    throw stream._readable._storedError;
  }

  const backpressure = ReadableStreamDefaultControllerHasBackpressure(readableController);
  if (backpressure !== stream._backpressure) {
    assert(backpressure === true);
    TransformStreamSetBackpressure(stream, true);
  }
}

function TransformStreamDefaultControllerError(controller, e) {
  TransformStreamError(controller._controlledTransformStream, e);
}

function TransformStreamDefaultControllerTerminate(controller) {
  verbose('TransformStreamDefaultControllerTerminate()');

  const stream = controller._controlledTransformStream;
  const readableController = stream._readable._readableStreamController;

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(readableController) === true) {
    ReadableStreamDefaultControllerClose(readableController);
  }

  const error = new TypeError('TransformStream terminated');
  TransformStreamErrorWritableAndUnblockWrite(stream, error);
}

// TransformStreamDefaultSink Algorithms

function TransformStreamDefaultSinkWriteAlgorithm(stream, chunk) {
  verbose('TransformStreamDefaultSinkWriteAlgorithm()');

  assert(stream._writable._state === 'writable');

  const controller = stream._transformStreamController;

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
          return controller._transformAlgorithm(chunk);
        });
  }

  return controller._transformAlgorithm(chunk);
}

function TransformStreamDefaultSinkAbortAlgorithm(stream) {
  // abort() is not called synchronously, so it is possible for abort() to be called when the stream is already
  // errored.
  const e = new TypeError('Writable side aborted');
  TransformStreamError(stream, e);
  return Promise.resolve();
}

function TransformStreamDefaultSinkCloseAlgorithm(stream) {
  verbose('TransformStreamDefaultSinkCloseAlgorithm()');

  // stream._readable cannot change after construction, so caching it across a call to user code is safe.
  const readable = stream._readable;

  const flushPromise = stream._transformStreamController._flushAlgorithm();
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

// TransformStreamDefaultSource Algorithms

function TransformStreamDefaultSourcePullAlgorithm(stream) {
  verbose('TransformStreamDefaultSourcePullAlgorithm()');

  // Invariant. Enforced by the promises returned by start() and pull().
  assert(stream._backpressure === true);

  assert(stream._backpressureChangePromise !== undefined);

  TransformStreamSetBackpressure(stream, false);

  // Prevent the next pull() call until there is backpressure.
  return stream._backpressureChangePromise;
}

module.exports = { CreateTransformStream, TransformStream };

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
