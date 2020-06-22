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
    if (this._ownerReadableStream === undefined) {
      return promiseRejectedWith(readerLockException('cancel'));
    }

    return aos.ReadableStreamReaderGenericCancel(this, reason);
  }

  read() {
    if (this._ownerReadableStream === undefined) {
      return promiseRejectedWith(readerLockException('read from'));
    }

    const promise = newPromise();
    aos.ReadableStreamDefaultReaderRead(
      this,
      chunk => resolvePromise(promise, { value: chunk, done: false }),
      () => resolvePromise(promise, { value: undefined, done: true }),
      err => rejectPromise(promise, err)
    );
    return promise;
  }

  releaseLock() {
    if (this._ownerReadableStream === undefined) {
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
