'use strict';
const assert = require('assert');
const { IsNonNegativeNumber, StructuredTransferOrClone } = require('./miscellaneous.js');

exports.DequeueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);
  assert(container._queue.length > 0);

  const pair = container._queue.shift();
  container._queueTotalSize -= pair.size;
  if (container._queueTotalSize < 0) {
    container._queueTotalSize = 0;
  }

  return pair.value;
};

exports.EnqueueValueWithSize = (container, value, size, transferList) => {
  assert('_queue' in container && '_queueTotalSize' in container);

  if (!IsNonNegativeNumber(size)) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }
  if (size === Infinity) {
    throw new RangeError('Size must be a finite, non-NaN, non-negative number.');
  }
  if (container._isOwning) {
    value = StructuredTransferOrClone(value, transferList);
  }
  container._queue.push({ value, size });
  container._queueTotalSize += size;
};

exports.PeekQueueValue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);
  assert(container._queue.length > 0);

  const pair = container._queue[0];
  return pair.value;
};

const closingStepsSymbol = Symbol('closing-steps');

exports.ResetQueue = container => {
  assert('_queue' in container && '_queueTotalSize' in container);

  if (container._isOwning) {
    while (container._queue.length > 0) {
      const value = exports.DequeueValue(container);
      if (typeof value[closingStepsSymbol] === 'function') {
        try {
          value[closingStepsSymbol]();
        } catch (closeException) {
          // Nothing to do.
        }
      }
    }
  }
  container._queue = [];
  container._queueTotalSize = 0;
};
