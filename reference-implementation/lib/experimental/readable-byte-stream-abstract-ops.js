var assert = require('assert');
import * as helpers from '../helpers';

export function ErrorReadableByteStream(stream, error) {
  if (stream._state === 'errored' || stream._state === 'closed') {
    return;
  }

  if (stream._state === 'waiting') {
    stream._readyPromise_reject(error);
    stream._readyPromise_resolve = null;
    stream._readyPromise_reject = null;
  } else {
    stream._readyPromise = Promise.reject(error);
    stream._readyPromise_resolve = null;
    stream._readyPromise_reject = null;
  }

  stream._state = 'errored';
  stream._storedError = error;

  stream._closedPromise_reject(error);
  stream._closedPromise_resolve = null;
  stream._closedPromise_reject = null;
}

export function IsReadableByteStream(x) {
  if (!helpers.typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingByteSource')) {
    return false;
  }

  return true;
}

export function IsReadableByteStreamLocked(stream) {
  assert(IsReadableByteStream(stream) === true,
         'IsReadableByteStreamLocked should only be used on known readable byte streams');

  if (stream._readableByteStreamReader === undefined) {
    return false;
  }

  return true;
}

export function ReadFromReadableByteStream(stream) {
  var readBufferSizeGetter = stream._underlyingByteSource['readBufferSize'];
  if (readBufferSizeGetter === undefined) {
    throw new TypeError('readBufferSize getter is not defined on the underlying byte source');
  }
  var readBufferSize = helpers.toInteger(readBufferSizeGetter.call(stream._underlyingByteSource));
  if (readBufferSize < 0) {
    throw new RangeError('readBufferSize must be non-negative');
  }

  var arrayBuffer = new ArrayBuffer(readBufferSize);
  var bytesRead = stream.readInto(arrayBuffer, 0, readBufferSize);
  // This code should be updated to use ArrayBuffer.prototype.transfer when
  // it's ready.
  var resizedArrayBuffer = arrayBuffer.slice(0, bytesRead);
  return resizedArrayBuffer;
}
