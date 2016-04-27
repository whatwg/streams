'use strict';
const assert = require('assert');
const { IsFiniteNonNegativeNumber } = require('./helpers.js');

exports.DequeueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never dequeue from an empty queue.');
  const pair = queue.shift();
  return pair.value;
};

exports.EnqueueValueWithSize = (queue, value, size) => {
  size = Number(size);
  if (!IsFiniteNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }

  queue.push({ value: value, size: size });
};

exports.GetTotalQueueSize = queue => {
  let totalSize = 0;

  queue.forEach(pair => {
    assert(typeof pair.size === 'number' && !Number.isNaN(pair.size) &&
      pair.size !== +Infinity && pair.size !== -Infinity,
      'Spec-level failure: should never find an invalid size in the queue.');
    totalSize += pair.size;
  });

  return totalSize;
};

exports.PeekQueueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never peek at an empty queue.');
  const pair = queue[0];
  return pair.value;
};
