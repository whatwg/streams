'use strict';
const { IsDetachedBuffer } = require('./ecmascript');

exports.IsNonNegativeNumber = v => {
  if (typeof v !== 'number') {
    return false;
  }

  if (Number.isNaN(v)) {
    return false;
  }

  if (v < 0) {
    return false;
  }

  return true;
};

exports.CloneAsUint8Array = O => {
  const buffer = O.buffer.slice(O.byteOffset, O.byteOffset + O.byteLength);
  return new Uint8Array(buffer);
};

exports.CanCopyDataBlockBytes = (toBuffer, toIndex, fromBuffer, fromIndex, count) => {
  if (toBuffer === fromBuffer) {
    return false;
  }
  if (IsDetachedBuffer(toBuffer) === true) {
    return false;
  }
  if (IsDetachedBuffer(fromBuffer) === true) {
    return false;
  }
  if (toIndex + count > toBuffer.byteLength) {
    return false;
  }
  if (fromIndex + count > fromBuffer.byteLength) {
    return false;
  }
  return true;
};
