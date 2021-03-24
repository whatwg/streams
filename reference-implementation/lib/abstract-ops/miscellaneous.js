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

// Implements StructuredDeserialize(StructuredSerialize(view)), but only for typed arrays and DataViews
exports.CloneArrayBufferView = view => {
  return new view.constructor(view.buffer.slice(), view.byteOffset, view.byteLength);
};
