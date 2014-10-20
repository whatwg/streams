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
