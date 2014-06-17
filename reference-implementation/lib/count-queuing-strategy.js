'use strict';

module.exports = CountQueuingStrategy;

function CountQueuingStrategy(options) {
  // TODO: use real destructuring semantics
  this.highWaterMark = Number(options.highWaterMark);

  if (Number.isNaN(this.highWaterMark)) {
    throw new TypeError('highWaterMark must be a number.');
  }
  if (this.highWaterMark < 0) {
    throw new RangeError('highWaterMark must be nonnegative.');
  }
}

CountQueuingStrategy.prototype.size = function (chunk) {
  return 1;
};

CountQueuingStrategy.prototype.needsMore = function (queueSize) {
  return queueSize < this.highWaterMark;
};
