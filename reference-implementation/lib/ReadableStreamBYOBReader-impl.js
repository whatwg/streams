'use strict';

const { promiseRejectedWith } = require('./helpers/webidl.js');
const aos = require('./abstract-ops/readable-streams.js');

exports.implementation = class ReadableStreamBYOBReaderImpl {
  constructor(globalObject, [stream]) {
    aos.SetUpReadableStreamBYOBReader(this, stream);
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

  read(view) {
    if (view.byteLength === 0) {
      return promiseRejectedWith(new TypeError('view must have non-zero byteLength'));
    }
    if (view.buffer.byteLength === 0) {
      return promiseRejectedWith(new TypeError('view\'s buffer must have non-zero byteLength'));
    }

    if (this._ownerReadableStream === undefined) {
      return promiseRejectedWith(readerLockException('read'));
    }

    return aos.ReadableStreamBYOBReaderRead(this, view);
  }

  releaseLock() {
    if (this._ownerReadableStream === undefined) {
      return;
    }

    if (this._readIntoRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    aos.ReadableStreamReaderGenericRelease(this);
  }
};

function readerLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released reader');
}
