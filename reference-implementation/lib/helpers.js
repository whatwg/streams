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
