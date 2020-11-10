'use strict';
const assert = require('assert');

const { Call, GetMethod, GetIterator, IteratorNext, IteratorComplete,
        IteratorValue } = require('./abstract-ops/ecmascript.js');
const { newPromise, resolvePromise, rejectPromise, promiseResolvedWith, promiseRejectedWith,
        setPromiseIsHandledToTrue, transformPromiseWith } = require('./helpers/webidl.js');
const { ExtractHighWaterMark, ExtractSizeAlgorithm } = require('./abstract-ops/queuing-strategy.js');
const aos = require('./abstract-ops/readable-streams.js');
const wsAOs = require('./abstract-ops/writable-streams.js');

const idlUtils = require('../generated/utils.js');
const UnderlyingSource = require('../generated/UnderlyingSource.js');

exports.implementation = class ReadableStreamImpl {
  constructor(globalObject, [underlyingSource, strategy]) {
    if (underlyingSource === undefined) {
      underlyingSource = null;
    }
    const underlyingSourceDict = UnderlyingSource.convert(underlyingSource);

    aos.InitializeReadableStream(this);

    if (underlyingSourceDict.type === 'bytes') {
      if ('size' in strategy) {
        throw new RangeError('The strategy for a byte stream cannot have a size function');
      }

      const highWaterMark = ExtractHighWaterMark(strategy, 0);
      aos.SetUpReadableByteStreamControllerFromUnderlyingSource(
        this, underlyingSource, underlyingSourceDict, highWaterMark
      );
    } else {
      assert(!('type' in underlyingSourceDict));
      const sizeAlgorithm = ExtractSizeAlgorithm(strategy);
      const highWaterMark = ExtractHighWaterMark(strategy, 1);
      aos.SetUpReadableStreamDefaultControllerFromUnderlyingSource(
        this, underlyingSource, underlyingSourceDict, highWaterMark, sizeAlgorithm
      );
    }
  }

  get locked() {
    return aos.IsReadableStreamLocked(this);
  }

  cancel(reason) {
    if (aos.IsReadableStreamLocked(this) === true) {
      return promiseRejectedWith(new TypeError('Cannot cancel a stream that already has a reader'));
    }

    return aos.ReadableStreamCancel(this, reason);
  }

  getReader(options) {
    if (!('mode' in options)) {
      return aos.AcquireReadableStreamDefaultReader(this);
    }

    assert(options.mode === 'byob');
    return aos.AcquireReadableStreamBYOBReader(this);
  }

  pipeThrough(transform, options) {
    // Type checking here is needed until https://github.com/jsdom/webidl2js/issues/81 is fixed.
    if ('signal' in options) {
      if (!isAbortSignal(options.signal)) {
        throw new TypeError('Invalid signal argument');
      }
    }

    if (aos.IsReadableStreamLocked(this) === true) {
      throw new TypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked ReadableStream');
    }
    if (wsAOs.IsWritableStreamLocked(transform.writable) === true) {
      throw new TypeError('ReadableStream.prototype.pipeThrough cannot be used on a locked WritableStream');
    }

    const promise = aos.ReadableStreamPipeTo(
      this, transform.writable, options.preventClose, options.preventAbort, options.preventCancel, options.signal
    );

    setPromiseIsHandledToTrue(promise);

    return transform.readable;
  }

  pipeTo(destination, options) {
    // Type checking here is needed until https://github.com/jsdom/webidl2js/issues/81 is fixed.
    if ('signal' in options) {
      if (!isAbortSignal(options.signal)) {
        return promiseRejectedWith(new TypeError('Invalid signal argument'));
      }
    }

    if (aos.IsReadableStreamLocked(this) === true) {
      return promiseRejectedWith(
        new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream')
      );
    }
    if (wsAOs.IsWritableStreamLocked(destination) === true) {
      return promiseRejectedWith(
        new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream')
      );
    }

    return aos.ReadableStreamPipeTo(
      this, destination, options.preventClose, options.preventAbort, options.preventCancel, options.signal
    );
  }

  tee() {
    // Conversion here is only needed until https://github.com/jsdom/webidl2js/pull/108 gets merged.
    return aos.ReadableStreamTee(this, false).map(idlUtils.wrapperForImpl);
  }

  [idlUtils.asyncIteratorInit](iterator, [options]) {
    iterator._reader = aos.AcquireReadableStreamDefaultReader(this);
    iterator._preventCancel = options.preventCancel;
  }

  [idlUtils.asyncIteratorNext](iterator) {
    const reader = iterator._reader;
    if (reader._stream === undefined) {
      return promiseRejectedWith(
        new TypeError('Cannot get the next iteration result once the reader has been released')
      );
    }

    const promise = newPromise();
    const readRequest = {
      chunkSteps: chunk => resolvePromise(promise, chunk),
      closeSteps: () => {
        aos.ReadableStreamReaderGenericRelease(reader);
        resolvePromise(promise, idlUtils.asyncIteratorEOI);
      },
      errorSteps: e => {
        aos.ReadableStreamReaderGenericRelease(reader);
        rejectPromise(promise, e);
      }
    };
    aos.ReadableStreamDefaultReaderRead(reader, readRequest);
    return promise;
  }

  [idlUtils.asyncIteratorReturn](iterator, arg) {
    const reader = iterator._reader;
    if (reader._stream === undefined) {
      return promiseResolvedWith(undefined);
    }

    assert(reader._readRequests.length === 0);

    if (iterator._preventCancel === false) {
      const result = aos.ReadableStreamReaderGenericCancel(reader, arg);
      aos.ReadableStreamReaderGenericRelease(reader);
      return result;
    }

    aos.ReadableStreamReaderGenericRelease(reader);
    return promiseResolvedWith(undefined);
  }

  static from(asyncIterable) {
    let stream;
    let iteratorRecord;

    function startAlgorithm() {
      iteratorRecord = GetIterator(asyncIterable, 'async');
    }

    function pullAlgorithm() {
      let nextResult;
      try {
        nextResult = IteratorNext(iteratorRecord);
      } catch (e) {
        return promiseRejectedWith(e);
      }
      const nextPromise = promiseResolvedWith(nextResult);
      return transformPromiseWith(nextPromise, iterResult => {
        if (typeof iterResult !== 'object') {
          throw new TypeError();
        }
        const done = IteratorComplete(iterResult);
        if (done === true) {
          aos.ReadableStreamDefaultControllerClose(stream._controller);
        } else {
          const value = IteratorValue(iterResult);
          aos.ReadableStreamDefaultControllerEnqueue(stream._controller, value);
        }
      });
    }

    function cancelAlgorithm() {
      let returnMethod;
      try {
        returnMethod = GetMethod(iteratorRecord.iterator, 'return');
      } catch (e) {
        return promiseRejectedWith(e);
      }
      if (returnMethod === undefined) {
        return promiseResolvedWith(undefined);
      }
      let returnResult;
      try {
        returnResult = Call(returnMethod, iteratorRecord.iterator);
      } catch (e) {
        return promiseRejectedWith(e);
      }
      return promiseResolvedWith(returnResult);
    }

    stream = aos.CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm);
    return stream;
  }
};

// See pipeTo()/pipeThrough() for why this is needed.
const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
function isAbortSignal(v) {
  try {
    abortedGetter.call(v);
    return true;
  } catch {
    return false;
  }
}
