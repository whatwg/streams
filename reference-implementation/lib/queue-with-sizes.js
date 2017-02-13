'use strict';
const assert = require('assert');
const { IsFiniteNonNegativeNumber } = require('./helpers.js');

exports.DequeueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container,
    'Spec-level failure: DequeueValue should only be used on containers with [[queue]] and [[queueTotalSize]].');
  assert(container._queue.length > 0, 'Spec-level failure: should never dequeue from an empty queue.');

  const pair = container._queue.shift();
  container._queueTotalSize -= pair.size;
  if (container._queueTotalSize < 0) {
    container._queueTotalSize = 0;
  }

  return pair.value;
};

exports.EnqueueValueWithSize = (container, value, size) => {
  assert('_queue' in container && '_queueTotalSize' in container,
    'Spec-level failure: EnqueueValueWithSize should only be used on containers with [[queue]] and ' +
    '[[queueTotalSize]].');

  size = Number(size);
  if (!IsFiniteNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }

  container._queue.push({ value, size });
  container._queueTotalSize += size;
};

exports.PeekQueueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container,
    'Spec-level failure: PeekQueueValue should only be used on containers with [[queue]] and [[queueTotalSize]].');
  assert(container._queue.length > 0, 'Spec-level failure: should never peek at an empty queue.');

  const pair = container._queue[0];
  return pair.value;
};

exports.ResetQueue = container => {
  assert('_queue' in container && '_queueTotalSize' in container,
    'Spec-level failure: ResetQueue should only be used on containers with [[queue]] and [[queueTotalSize]].');

  container._queue = [];
  container._queueTotalSize = 0;
};
