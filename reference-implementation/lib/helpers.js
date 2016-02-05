const assert = require('assert');

export function promiseCall(func, ...args) {
  try {
    return Promise.resolve(func(...args));
  } catch (e) {
    return Promise.reject(e);
  }
}

export function typeIsObject(x) {
  return (typeof x === 'object' && x !== null) || typeof x === 'function';
}

export function toInteger(v) {
  v = Number(v);
  if (isNaN(v)) {
    return 0;
  }

  if (v < 0) {
    return -1 * Math.floor(Math.abs(v));
  }

  return Math.floor(Math.abs(v));
}

export function isFiniteNonNegativeNumber(v) {
  return !Number.isNaN(v) && v !== +Infinity && v >= 0;
}

export function createDataProperty(o, p, v) {
  assert(typeIsObject(o));
  Object.defineProperty(o, p, { value: v, writable: true, enumerable: true, configurable: true });
}

export function createArrayFromList(elements) {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice();
}

export function CreateIterResultObject(value, done) {
  assert(typeof done === 'boolean');
  const obj = {};
  Object.defineProperty(obj, 'value', { value: value, enumerable: true, writable: true, configurable: true });
  Object.defineProperty(obj, 'done', { value: done, enumerable: true, writable: true, configurable: true });
  return obj;
}

export function InvokeOrNoop(O, P, args) {
  const method = O[P];
  if (method === undefined) {
    return undefined;
  }
  return method.apply(O, args);
}

export function PromiseInvokeOrNoop(O, P, args) {
  let method;
  try {
    method = O[P];
  } catch (methodE) {
    return Promise.reject(methodE);
  }

  if (method === undefined) {
    return Promise.resolve(undefined);
  }

  try {
    return Promise.resolve(method.apply(O, args));
  } catch (e) {
    return Promise.reject(e);
  }
}

export function PromiseInvokeOrFallbackOrNoop(O, P1, args1, P2, args2) {
  let method;
  try {
    method = O[P1];
  } catch (methodE) {
    return Promise.reject(methodE);
  }

  if (method === undefined) {
    return PromiseInvokeOrNoop(O, P2, args2);
  }

  try {
    return Promise.resolve(method.apply(O, args1));
  } catch (e) {
    return Promise.reject(e);
  }
}

export function TransferArrayBuffer(buffer) {
  // No-op. Just for marking places where detaching an ArrayBuffer is required.

  return buffer;
}

export function ValidateAndNormalizeHighWaterMark(highWaterMark) {
  highWaterMark = Number(highWaterMark);
  if (Number.isNaN(highWaterMark)) {
    throw new TypeError('highWaterMark property of a queuing strategy must be convertible to a non-NaN number');
  }
  if (highWaterMark < 0) {
    throw new RangeError('highWaterMark property of a queuing strategy must be nonnegative');
  }

  return highWaterMark;
}

export function ValidateAndNormalizeQueuingStrategy(size, highWaterMark) {
  if (size !== undefined && typeof size !== 'function') {
    throw new TypeError('size property of a queuing strategy must be a function');
  }

  highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);

  return { size, highWaterMark };
}
