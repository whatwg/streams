'use strict';
const assert = require('assert');

const { CancelSteps, PullSteps, ReleaseSteps } = require('./abstract-ops/internal-methods.js');
const { ResetQueue } = require('./abstract-ops/queue-with-sizes.js');
const aos = require('./abstract-ops/readable-streams.js');

exports.implementation = class ReadableByteStreamControllerImpl {
  get byobRequest() {
    return aos.ReadableByteStreamControllerGetBYOBRequest(this);
  }

  get desiredSize() {
    return aos.ReadableByteStreamControllerGetDesiredSize(this);
  }

  close() {
    if (this._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    const state = this._stream._state;
    if (state !== 'readable') {
      throw new TypeError(`The stream (in ${state} state) is not in the readable state and cannot be closed`);
    }

    aos.ReadableByteStreamControllerClose(this);
  }

  enqueue(chunk) {
    if (chunk.byteLength === 0) {
      throw new TypeError('chunk must have non-zero byteLength');
    }
    if (chunk.buffer.byteLength === 0) {
      throw new TypeError('chunk\'s buffer must have non-zero byteLength');
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    const state = this._stream._state;
    if (state !== 'readable') {
      throw new TypeError(`The stream (in ${state} state) is not in the readable state and cannot be enqueued to`);
    }

    aos.ReadableByteStreamControllerEnqueue(this, chunk);
  }

  error(e) {
    aos.ReadableByteStreamControllerError(this, e);
  }

  [CancelSteps](reason) {
    aos.ReadableByteStreamControllerClearPendingPullIntos(this);

    ResetQueue(this);

    const result = this._cancelAlgorithm(reason);
    aos.ReadableByteStreamControllerClearAlgorithms(this);
    return result;
  }

  [PullSteps](readRequest) {
    const stream = this._stream;
    assert(aos.ReadableStreamHasDefaultReader(stream) === true);

    if (this._queueTotalSize > 0) {
      assert(aos.ReadableStreamGetNumReadRequests(stream) === 0);
      aos.ReadableByteStreamControllerFillReadRequestFromQueue(this, readRequest);
      return;
    }

    const autoAllocateChunkSize = this._autoAllocateChunkSize;
    if (autoAllocateChunkSize !== undefined) {
      let buffer;
      try {
        buffer = new ArrayBuffer(autoAllocateChunkSize);
      } catch (bufferE) {
        readRequest.errorSteps(bufferE);
        return;
      }

      const pullIntoDescriptor = {
        buffer,
        bufferByteLength: autoAllocateChunkSize,
        byteOffset: 0,
        byteLength: autoAllocateChunkSize,
        bytesFilled: 0,
        elementSize: 1,
        viewConstructor: Uint8Array,
        readerType: 'default',
        minimumFilled: 1
      };

      this._pendingPullIntos.push(pullIntoDescriptor);
    }

    aos.ReadableStreamAddReadRequest(stream, readRequest);
    aos.ReadableByteStreamControllerCallPullIfNeeded(this);
  }

  [ReleaseSteps]() {
    if (this._pendingPullIntos.length > 0) {
      const firstPullInto = this._pendingPullIntos[0];
      firstPullInto.readerType = 'none';

      this._pendingPullIntos = [firstPullInto];
    }
  }
};
