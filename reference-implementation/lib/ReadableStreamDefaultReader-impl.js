'use strict';

const { newPromise, resolvePromise, rejectPromise, promiseRejectedWith } = require('./helpers/webidl.js');
const aos = require('./abstract-ops/readable-streams.js');

exports.implementation = class ReadableStreamDefaultReaderImpl {
  constructor(globalObject, [stream]) {
    aos.SetUpReadableStreamDefaultReader(this, stream);
  }

  get closed() {
    return this._closedPromise;
  }

  cancel(reason) {
    if (this._stream === undefined) {
      return promiseRejectedWith(readerLockException('cancel'));
    }

    return aos.ReadableStreamReaderGenericCancel(this, reason);
  }

  read() {
    if (this._stream === undefined) {
      return promiseRejectedWith(readerLockException('read from'));
    }

    const promise = newPromise();
    const readRequest = {
      chunkSteps: chunk => resolvePromise(promise, { value: chunk, done: false }),
      closeSteps: () => resolvePromise(promise, { value: undefined, done: true }),
      errorSteps: e => rejectPromise(promise, e)
    };

    aos.ReadableStreamDefaultReaderRead(this, readRequest);
    return promise;
  }

  releaseLock() {
    if (this._stream === undefined) {
      return;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    aos.ReadableStreamReaderGenericRelease(this);
  }
};

function readerLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released reader');
}
