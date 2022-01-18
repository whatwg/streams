'use strict';

const { newPromise, resolvePromise, rejectPromise, promiseRejectedWith } = require('./helpers/webidl.js');
const { IsDetachedBuffer } = require('./abstract-ops/ecmascript.js');
const aos = require('./abstract-ops/readable-streams.js');
const { mixin } = require('./helpers/miscellaneous.js');
const ReadableStreamGenericReaderImpl = require('./ReadableStreamGenericReader-impl.js').implementation;

class ReadableStreamBYOBReaderImpl {
  constructor(globalObject, [stream]) {
    aos.SetUpReadableStreamBYOBReader(this, stream);
  }

  read(view, options) {
    if (view.byteLength === 0) {
      return promiseRejectedWith(new TypeError('view must have non-zero byteLength'));
    }
    if (view.buffer.byteLength === 0) {
      return promiseRejectedWith(new TypeError('view\'s buffer must have non-zero byteLength'));
    }
    if (IsDetachedBuffer(view.buffer) === true) {
      return promiseRejectedWith(new TypeError('view\'s buffer has been detached'));
    }

    let minimumFill;
    if ('atLeast' in options) {
      if (view.constructor !== DataView) {
        if (options.atLeast > view.length) {
          return promiseRejectedWith(
            new RangeError('options.atLeast must be less than or equal to view\'s length')
          );
        }
        const elementSize = view.constructor.BYTES_PER_ELEMENT;
        minimumFill = options.atLeast * elementSize;
      } else {
        if (options.atLeast > view.byteLength) {
          return promiseRejectedWith(
            new RangeError('options.atLeast must be less than or equal to view\'s byteLength')
          );
        }
        minimumFill = options.atLeast;
      }
    }

    if (this._stream === undefined) {
      return promiseRejectedWith(readerLockException('read'));
    }

    const promise = newPromise();
    const readIntoRequest = {
      chunkSteps: chunk => resolvePromise(promise, { value: chunk, done: false }),
      closeSteps: chunk => resolvePromise(promise, { value: chunk, done: true }),
      errorSteps: e => rejectPromise(promise, e)
    };
    aos.ReadableStreamBYOBReaderRead(this, view, readIntoRequest, minimumFill);
    return promise;
  }

  releaseLock() {
    if (this._stream === undefined) {
      return;
    }

    aos.ReadableStreamBYOBReaderRelease(this);
  }
}

mixin(ReadableStreamBYOBReaderImpl.prototype, ReadableStreamGenericReaderImpl.prototype);

exports.implementation = ReadableStreamBYOBReaderImpl;

function readerLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released reader');
}
