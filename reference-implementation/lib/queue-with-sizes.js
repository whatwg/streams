var assert = require('assert');

export function DequeueValue(queue) {
  assert(queue.length > 0, 'Spec-level failure: should never dequeue from an empty queue.');
  var pair = queue.shift();
  return pair.value;
}

export function EnqueueValueWithSize(queue, value, size) {
  size = Number(size);
  if (Number.isNaN(size) || size === +Infinity || size === -Infinity) {
    throw new RangeError('Size must be a finite, non-NaN number.');
  }

  queue.push({ value: value, size: size });
}

export function GetTotalQueueSize(queue) {
  var totalSize = 0;

  queue.forEach(pair => {
    assert(typeof pair.size === 'number' && !Number.isNaN(pair.size) &&
      pair.size !== +Infinity && pair.size !== -Infinity,
      'Spec-level failure: should never find an invalid size in the queue.');
    totalSize += pair.size;
  });

  return totalSize;
}

export function PeekQueueValue(queue) {
  assert(queue.length > 0, 'Spec-level failure: should never peek at an empty queue.');
  var pair = queue[0];
  return pair.value;
}
