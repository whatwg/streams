'use strict';

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

exports.StructuredTransferOrClone = (value, transferList) => {
  return globalThis.structuredClone(value, { transfer: transferList });
};
