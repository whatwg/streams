'use strict';
const assert = require('assert');
const { IsFiniteNonNegativeNumber } = require('./helpers.js');

const InternalTotalSize = Symbol('[[InternalTotalSize]]');

exports.DequeueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never dequeue from an empty queue.');
  const pair = queue.shift();
  queue[InternalTotalSize] -= pair.size;
  return pair.value;
};

exports.EnqueueValueWithSize = (queue, value, size) => {
  size = Number(size);
  if (!IsFiniteNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }

  queue.push({ value: value, size: size });

  if (queue[InternalTotalSize] === undefined) {
    queue[InternalTotalSize] = 0;
  }
  queue[InternalTotalSize] += size;
};

exports.GetTotalQueueSize = queue => {
  if (queue[InternalTotalSize] === undefined) {
    queue[InternalTotalSize] = 0;
  }
  return queue[InternalTotalSize];
};

exports.PeekQueueValue = queue => {
  assert(queue.length > 0, 'Spec-level failure: should never peek at an empty queue.');
  const pair = queue[0];
  return pair.value;
};
