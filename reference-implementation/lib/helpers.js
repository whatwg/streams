var assert = require('assert');

export function promiseCall(func) {
  var args = Array.prototype.slice.call(arguments, 1);

  try {
    return Promise.resolve(func.apply(undefined, args));
  } catch (e) {
    return Promise.reject(e);
  }
}

export function enqueueValueWithSize(queue, value, size) {
  size = Number(size);
  if (Number.isNaN(size)) {
    throw new TypeError('Size must be a non-NaN number');
  }

  queue.push({ value: value, size: size });
}

export function peekQueueValue(queue) {
  assert(queue.length > 0, 'Spec-level failure: should never be able to peek at an empty queue.');
  return queue[0].value;
}

export function dequeueValue(queue) {
  assert(queue.length > 0, 'Spec-level failure: should never be able to dequeue from an empty queue.');
  var pair = queue.shift();
  return pair.value;
}

export function getTotalQueueSize(queue) {
  var totalSize = 0;

  queue.forEach(pair => {
    assert(typeof pair.size === 'number' && !Number.isNaN(pair.size),
      'Spec-level failure: should never find an invalid size in the queue.');
    totalSize += pair.size;
  });

  return totalSize;
};

export function typeIsObject(x) {
  return (typeof x === 'object' && x !== null) || typeof x === 'function';
}
