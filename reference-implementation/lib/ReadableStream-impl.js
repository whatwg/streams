'use strict';
const assert = require('assert');

const { promiseRejectedWith, setPromiseIsHandledToTrue } = require('./helpers/webidl.js');
const { ExtractHighWaterMark, ExtractSizeAlgorithm } = require('./abstract-ops/queuing-strategy.js');
const aos = require('./abstract-ops/readable-streams.js');
const wsAOs = require('./abstract-ops/writable-streams.js');

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
      return aos.AcquireReadableStreamDefaultReader(this, true);
    }

    assert(options.mode === 'byob');
    return aos.AcquireReadableStreamBYOBReader(this, true);
  }

  pipeThrough(transform, options) {
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
    return aos.ReadableStreamTee(this, false);
  }
};
