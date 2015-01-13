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
