'use strict';
const assert = require('assert');

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

exports.PromiseInvokeOrPerformFallback = (O, P, args, F, argsF) => {
  assert(O !== undefined);
  assert(IsPropertyKey(P));
  assert(Array.isArray(args));
  assert(Array.isArray(argsF));

  let method;
  try {
    method = O[P];
  } catch (methodE) {
    return Promise.reject(methodE);
  }

  if (method === undefined) {
    return F(...argsF);
  }

  try {
    return Promise.resolve(Call(method, O, args));
  } catch (e) {
    return Promise.reject(e);
  }
};

exports.PromiseInvokeOrFallbackOrNoop = (O, P1, args1, P2, args2) => {
  assert(O !== undefined);
  assert(IsPropertyKey(P1));
  assert(Array.isArray(args1));
  assert(IsPropertyKey(P2));
  assert(Array.isArray(args2));

  return exports.PromiseInvokeOrPerformFallback(O, P1, args1, exports.PromiseInvokeOrNoop, [O, P2, args2]);
};

// Not implemented correctly
exports.SameRealmTransfer = O => O;

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
