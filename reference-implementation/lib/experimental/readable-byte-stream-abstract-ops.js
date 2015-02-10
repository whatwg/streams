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

export function ReadFromReadableByteStream(stream) {
  if (stream._readBufferSize === undefined) {
    throw new TypeError('readBufferSize is not configured');
  }

  var arrayBuffer = new ArrayBuffer(stream._readBufferSize);
  var bytesRead = stream.readInto(arrayBuffer, 0, stream._readBufferSize);
  // This code should be updated to use ArrayBuffer.prototype.transfer when
  // it's ready.
  var resizedArrayBuffer = arrayBuffer.slice(0, bytesRead);
  return resizedArrayBuffer;
}
