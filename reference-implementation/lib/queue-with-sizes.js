'use strict';
const assert = require('better-assert');
const { IsFiniteNonNegativeNumber } = require('./helpers.js');

const DequeueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);
  assert(container._queue.length > 0);

  const pair = container._queue.shift();
  container._queueTotalSize -= pair.size;
  if (container._queueTotalSize < 0) {
    container._queueTotalSize = 0;
  }

  return pair.value;
};

const EnqueueValueWithSize = (container, value, size) => {
  assert('_queue' in container && '_queueTotalSize' in container);

  size = Number(size);
  if (!IsFiniteNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }

  container._queue.push({ value, size });
  container._queueTotalSize += size;
};

const PeekQueueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);
  assert(container._queue.length > 0);

  const pair = container._queue[0];
  return pair.value;
};

const ResetQueue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);

  container._queue = [];
  container._queueTotalSize = 0;
};

module.exports = {
  DequeueValue,
  EnqueueValueWithSize,
  PeekQueueValue,
  ResetQueue
};
