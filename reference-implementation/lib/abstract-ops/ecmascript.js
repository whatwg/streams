'use strict';
const assert = require('assert');

const ArrayBufferPrototypeTransferToFixedLength = ArrayBuffer.prototype.transferToFixedLength;
const ArrayBufferPrototypeDetachedGetter = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'detached').get;

exports.typeIsObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';

exports.CreateArrayFromList = elements => {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice();
};

exports.CopyDataBlockBytes = (dest, destOffset, src, srcOffset, n) => {
  new Uint8Array(dest).set(new Uint8Array(src, srcOffset, n), destOffset);
};

exports.TransferArrayBuffer = O => {
  assert(!exports.IsDetachedBuffer(O));
  return ArrayBufferPrototypeTransferToFixedLength.call(O);
};

exports.CanTransferArrayBuffer = O => {
  return !exports.IsDetachedBuffer(O);
};

exports.IsDetachedBuffer = O => {
  return ArrayBufferPrototypeDetachedGetter.call(O) === true;
};

exports.IteratorNext = (iteratorRecord, value) => {
  let result;
  if (value === undefined) {
    result = exports.Call(iteratorRecord.nextMethod, iteratorRecord.iterator);
  } else {
    result = exports.Call(iteratorRecord.nextMethod, iteratorRecord.iterator, [value]);
  }
  if (!exports.typeIsObject(result)) {
    throw new TypeError('The iterator.next() method must return an object');
  }
  return result;
};

exports.IteratorComplete = iterResult => {
  assert(exports.typeIsObject(iterResult));
  return Boolean(iterResult.done);
};

exports.IteratorValue = iterResult => {
  assert(exports.typeIsObject(iterResult));
  return iterResult.value;
};
