'use strict';
const assert = require('assert');
const { IsFiniteNonNegativeNumber } = require('./helpers.js');

exports.DequeueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never dequeue from an empty queue.');
  const pair = queue.shift();

  queue._totalSize -= pair.size;

  return pair.value;
};

exports.EnqueueValueWithSize = (queue, value, size) => {
  size = Number(size);
  if (!IsFiniteNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }

  queue.push({ value, size });

  if (queue._totalSize === undefined) {
    queue._totalSize = 0;
  }
  queue._totalSize += size;
};

// This implementation is not per-spec. Total size is cached for speed.
exports.GetTotalQueueSize = queue => {
  if (queue._totalSize === undefined) {
    queue._totalSize = 0;
  }
  return queue._totalSize;
};

exports.PeekQueueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never peek at an empty queue.');
  const pair = queue[0];
  return pair.value;
};
