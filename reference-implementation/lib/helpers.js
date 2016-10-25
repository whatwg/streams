'use strict';
const assert = require('assert');

exports.promiseCall = (func, ...args) => {
  try {
    return Promise.resolve(func(...args));
  } catch (e) {
    return Promise.reject(e);
  }
};

exports.typeIsObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';

exports.toInteger = v => {
  v = Number(v);
  if (isNaN(v)) {
    return 0;
  }

  if (v < 0) {
    return -1 * Math.floor(Math.abs(v));
  }

  return Math.floor(Math.abs(v));
};

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

exports.InvokeOrNoop = (O, P, args) => {
  const method = O[P];
  if (method === undefined) {
    return undefined;
  }
  return method.apply(O, args);
};

exports.PromiseInvokeOrNoop = (O, P, args) => {
  try {
    return Promise.resolve(exports.InvokeOrNoop(O, P, args));
  } catch (returnValueE) {
    return Promise.reject(returnValueE);
  }
};

exports.PromiseInvokeOrFallbackOrNoop = (O, P1, args1, P2, args2) => {
  let method;
  try {
    method = O[P1];
  } catch (methodE) {
    return Promise.reject(methodE);
  }

  if (method === undefined) {
    return exports.PromiseInvokeOrNoop(O, P2, args2);
  }

  try {
    return Promise.resolve(method.apply(O, args1));
  } catch (e) {
    return Promise.reject(e);
  }
};

// Not implemented correctly
exports.SameRealmTransfer = O => O;

exports.ValidateAndNormalizeHighWaterMark = highWaterMark => {
  highWaterMark = Number(highWaterMark);
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('highWaterMark property of a queuing strategy must be nonnegative and non-NaN');
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
