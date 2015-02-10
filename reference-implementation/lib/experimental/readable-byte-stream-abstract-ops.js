var assert = require('assert');
import * as helpers from '../helpers';

export function CloseReadableByteStream(stream) {
  if (IsReadableByteStreamLocked(stream)) {
    CloseReadableByteStreamReader(stream._readableByteStreamReader);

    stream._readableByteStreamReader = undefined;

    // rs.ready() was pending because there was a reader.
    stream._resolveReadyPromise(undefined);
  } else if (stream._state === 'waiting') {
    stream._resolveReadyPromise(undefined);
  }

  stream._resolveClosedPromise(undefined);

  stream._state = 'closed';

  return undefined;
}

export function CloseReadableByteStreamReader(reader) {
  if (reader._state === 'waiting') {
    reader._resolveReadyPromise(undefined);
  }
  reader._resolveClosedPromise(undefined);
  reader._state = 'closed';
}

export function CreateNotifyReadyFunction(stream) {
  return () => {
    if (stream._state !== 'waiting') {
      return;
    }

    if (IsReadableByteStreamLocked(stream)) {
      stream._readableByteStreamReader._resolveReadyPromise(undefined);

      stream._readableByteStreamReader._state = 'readable';
    } else {
      stream._resolveReadyPromise(undefined);
    }

    stream._state = 'readable';
  };
}

export function ErrorReadableByteStream(stream, e) {
  if (stream._state === 'errored' || stream._state === 'closed') {
    return;
  }

  if (IsReadableByteStreamLocked(stream)) {
    if (stream._state === 'waiting') {
      stream._readableByteStreamReader._resolveReadyPromise(undefined);
    }

    // rs.ready() was pending because there was a reader.
    stream._resolveReadyPromise(undefined);

    stream._readableByteStreamReader._rejectClosedPromise(e);

    stream._readableByteStreamReader._state = 'errored';

    stream._readableByteStreamReader = undefined;
  } else if (stream._state === 'waiting') {
    stream._resolveReadyPromise(undefined);
  }
  stream._rejectClosedPromise(e);

  stream._storedError = e;
  stream._state = 'errored';
}

export function IsExclusiveByteStreamReader(x) {
  if (!helpers.typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_encapsulatedReadableByteStream')) {
    return false;
  }

  return true;
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

export function ReadIntoFromReadableByteStream(stream, arrayBuffer, offset, size) {
  if (stream._state === 'waiting') {
    throw new TypeError('not ready for read');
  }
  if (stream._state === 'closed') {
    throw new TypeError('stream has already been consumed');
  }
  if (stream._state === 'errored') {
    throw stream._storedError;
  }

  assert(stream._state === 'readable', `stream state ${stream._state} is invalid`);

  if (offset === undefined) {
    offset = 0;
  } else {
    offset = helpers.toInteger(offset);

    if (offset < 0) {
      throw new RangeError('offset must be non-negative');
    }
  }

  if (size === undefined) {
    size = arrayBuffer.byteLength - offset;
  } else {
    size = helpers.toInteger(size);
  }

  if (size < 0) {
    throw new RangeError('size must be non-negative');
  }
  if (offset + size > arrayBuffer.byteLength) {
    throw new RangeError('the specified range is out of bounds for arrayBuffer');
  }

  var bytesRead;
  try {
    var readInto = stream._underlyingByteSource['readInto'];
    if (readInto === undefined) {
      throw new TypeError('readInto is not defiend on the underlying byte source');
    }
    bytesRead = readInto.call(stream._underlyingByteSource, arrayBuffer, offset, size);
  } catch (error) {
    ErrorReadableByteStream(stream, error);
    throw error;
  }

  bytesRead = Number(bytesRead);

  if (isNaN(bytesRead) || bytesRead < -2 || bytesRead > size) {
    var error = new RangeError('readInto of underlying source returned invalid value');
    ErrorReadableByteStream(stream, error);
    throw error;
  }

  if (bytesRead === -1) {
    CloseReadableByteStream(stream);

    // Let the user investigate state again.
    return 0;
  }

  if (bytesRead === -2) {
    if (IsReadableByteStreamLocked(stream)) {
      stream._readableByteStreamReader._initReadyPromise();

      stream._readableByteStreamReader._state = 'waiting';
    } else {
      stream._initReadyPromise();
    }

    stream._state = 'waiting';

    return 0;
  }

  return bytesRead;
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
  var bytesRead = ReadIntoFromReadableByteStream(stream, arrayBuffer, 0, readBufferSize);
  // This code should be updated to use ArrayBuffer.prototype.transfer when
  // it's ready.
  var resizedArrayBuffer = arrayBuffer.slice(0, bytesRead);
  return resizedArrayBuffer;
}
