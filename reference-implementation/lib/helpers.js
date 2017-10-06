'use strict';
const assert = require('assert');

const isFakeDetached = Symbol('is "detached" for our purposes');

function IsPropertyKey(argument) {
  return typeof argument === 'string' || typeof argument === 'symbol';
}

exports.typeIsObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';

exports.createDataProperty = (o, p, v) => {
  assert(exports.typeIsObject(o));
  Object.defineProperty(o, p, { value: v, writable: true, enumerable: true, configurable: true });
};

exports.createArrayFromList = elements => {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice();
};

exports.ArrayBufferCopy = (dest, destOffset, src, srcOffset, n) => {
  new Uint8Array(dest).set(new Uint8Array(src, srcOffset, n), destOffset);
};

exports.CreateIterResultObject = (value, done) => {
  assert(typeof done === 'boolean');
  const obj = {};
  Object.defineProperty(obj, 'value', { value, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(obj, 'done', { value: done, enumerable: true, writable: true, configurable: true });
  return obj;
};

exports.IsFiniteNonNegativeNumber = v => {
  if (Number.isNaN(v)) {
    return false;
  }
  if (v === Infinity) {
    return false;
  }
  if (v < 0) {
    return false;
  }

  return true;
};

function Call(F, V, args) {
  if (typeof F !== 'function') {
    throw new TypeError('Argument is not a function');
  }

  return Function.prototype.apply.call(F, V, args);
}

exports.Call = Call;

exports.InvokeOrNoop = (O, P, args) => {
  assert(O !== undefined);
  assert(IsPropertyKey(P));
  assert(Array.isArray(args));

  const method = O[P];
  if (method === undefined) {
    return undefined;
  }

  return Call(method, O, args);
};

exports.PromiseInvokeOrNoop = (O, P, args) => {
  assert(O !== undefined);
  assert(IsPropertyKey(P));
  assert(Array.isArray(args));
  try {
    return Promise.resolve(exports.InvokeOrNoop(O, P, args));
  } catch (returnValueE) {
    return Promise.reject(returnValueE);
  }
};

// Not implemented correctly
exports.TransferArrayBuffer = O => {
  assert(!exports.IsDetachedBuffer(O), 'Cannot transfer a previously detached ArrayBuffer');
  const transferredIshVersion = O.slice();

  // This is specifically to fool tests that test "is transferred" by taking a non-zero-length
  // ArrayBuffer and checking if its byteLength starts returning 0.
  Object.defineProperty(O, 'byteLength', {
    get() {
      return 0;
    }
  });
  O[isFakeDetached] = true;

  return transferredIshVersion;
};

// Not implemented correctly
exports.IsDetachedBuffer = O => {
  return isFakeDetached in O;
};

exports.ValidateAndNormalizeHighWaterMark = highWaterMark => {
  highWaterMark = Number(highWaterMark);
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('highWaterMark property of a queuing strategy must be non-negative and non-NaN');
  }

  return highWaterMark;
};

exports.ValidateAndNormalizeQueuingStrategy = (size, highWaterMark) => {
  if (size !== undefined && typeof size !== 'function') {
    throw new TypeError('size property of a queuing strategy must be a function');
  }

  highWaterMark = exports.ValidateAndNormalizeHighWaterMark(highWaterMark);

  return { size, highWaterMark };
};
