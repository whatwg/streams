'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } = require('./helpers.js');
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

  if (transformStream._pullSuppressed === true) {
    assert(transformStream._pullSuppressPromise !== undefined);
    assert(transformStream._pullSuppressPromise_resolve !== undefined);

    transformStream._pullSuppressed = false;

    transformStream._pullSuppressPromise_resolve();
    transformStream._pullSuppressPromise = undefined;
    transformStream._pullSuppressPromise_resolve = undefined;
  }

  try {
    controller.enqueue(chunk);
  } catch (e) {
    // This happens when readableStrategy.size() throws.
    // The ReadableStream has already errored itself.
    transformStream._readableClosed = true;
    TransformStreamErrorIfNeeded(transformStream, e);

    throw transformStream._storedError;
  }

  if (transformStream._readableBackpressure === false && controller.desiredSize <= 0) {
    assert(transformStream._backpressureGonePromise === undefined);
    assert(transformStream._backpressureGonePromise_resolve === undefined);

    transformStream._readableBackpressure = true;

    transformStream._backpressureGonePromise = new Promise(resolve => {
      transformStream._backpressureGonePromise_resolve = resolve;
    });
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
}

function TransformStreamReadyPromise(transformStream) {
  if (transformStream._readableBackpressure === false) {
    return Promise.resolve();
  }

  assert(transformStream._backpressureGonePromise !== undefined);

  return transformStream._backpressureGonePromise;
}

function TransformStreamTransform(transformStream, chunk) {
  // console.log('TransformStreamTransform()');

  assert(transformStream._errored === false);
  assert(transformStream._transforming === false);
  assert(transformStream._readableBackpressure === false);

  transformStream._transforming = true;

  const controller = transformStream._transformStreamController;
  const transformPromise = PromiseInvokeOrNoop(transformStream._transformer,
                             'transform', [chunk, controller]);

  return transformPromise.then(
    () => {
      transformStream._transforming = false;
      // Do not fulfill until there's no backpressure.
      return TransformStreamReadyPromise(transformStream);
    },
    e => TransformStreamErrorIfNeeded(transformStream, e));
}

function IsTransformStreamDefaultController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledTransformStream')) {
    return false;
  }

  return true;
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

class TransformStreamSink {
  constructor(transformStream, startPromise) {
    this._transformStream = transformStream;
    this._startPromise = startPromise;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._writableController = c;

    // delay all sink.write() calls until there is no longer backpressure.
    return this._startPromise.then(() => TransformStreamReadyPromise(transformStream));
  }

  write(chunk) {
    // console.log('TransformStreamSink.write()');

    const transformStream = this._transformStream;

    return TransformStreamTransform(transformStream, chunk);
  }

  abort() {
    const transformStream = this._transformStream;
    transformStream._writableDone = true;
    TransformStreamErrorInternal(transformStream, new TypeError('Writable side aborted'));
  }

  close() {
    // console.log('TransformStreamSink.close()');

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

class TransformStreamSource {
  constructor(transformStream, startPromise) {
    this._transformStream = transformStream;
    this._startPromise = startPromise;
  }

  start(c) {
    const transformStream = this._transformStream;

    transformStream._readableController = c;

    // delay the first source.pull call until there is backpressure
    return this._startPromise;
  }

  pull() {
    // console.log('TransformStreamSource.pull()');

    const transformStream = this._transformStream;

    assert(transformStream._pullSuppressed === false);
    assert(transformStream._pullSuppressPromise === undefined);
    assert(transformStream._pullSuppressPromise_resolve === undefined);

    transformStream._pullSuppressed = true;

    transformStream._pullSuppressPromise = new Promise(resolve => {
      transformStream._pullSuppressPromise_resolve = resolve;
    });

    if (transformStream._readableBackpressure === true) {
      assert(transformStream._backpressureGonePromise !== undefined);
      assert(transformStream._backpressureGonePromise_resolve !== undefined);

      transformStream._readableBackpressure = false;

      transformStream._backpressureGonePromise_resolve();
      transformStream._backpressureGonePromise = undefined;
      transformStream._backpressureGonePromise_resolve = undefined;
    }

    return transformStream._pullSuppressPromise;
  }

  cancel() {
    const transformStream = this._transformStream;
    transformStream._readableClosed = true;
    TransformStreamErrorInternal(transformStream, new TypeError('Readable side canceled'));
  }
}

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

    return transformStream._readableController.desiredSize;
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
    this._transformStreamController = undefined;

    this._writableDone = false;
    this._readableClosed = false;

    this._readableBackpressure = true;
    this._backpressureGonePromise = new Promise(resolve => {
      this._backpressureGonePromise_resolve = resolve;
    });

    this._pullSuppressed = false;
    this._pullSuppressPromise = undefined;
    this._pullSuppressPromise_resolve = undefined;

    this._transformStreamController = new TransformStreamDefaultController(this);

    let startPromise_resolve;
    const startPromise = new Promise(resolve => {
      startPromise_resolve = resolve;
    });

    const source = new TransformStreamSource(this, startPromise);

    this._readable = new ReadableStream(source, transformer.readableStrategy);

    const sink = new TransformStreamSink(this, startPromise);

    this._writable = new WritableStream(sink, transformer.writableStrategy);

    assert(this._writableController !== undefined);
    assert(this._readableController !== undefined);

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
};

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
