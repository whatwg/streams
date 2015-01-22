import { typeIsObject } from './helpers';

export default class CountQueuingStrategy {
  constructor({ highWaterMark }) {
    highWaterMark = Number(highWaterMark);

    if (Number.isNaN(highWaterMark)) {
      throw new TypeError('highWaterMark must be a number.');
    }
    if (highWaterMark < 0) {
      throw new RangeError('highWaterMark must be nonnegative.');
    }

    this._cqsHighWaterMark = highWaterMark;
  }

  shouldApplyBackpressure(queueSize) {
    if (!typeIsObject(this)) {
      throw new TypeError('CountQueuingStrategy.prototype.shouldApplyBackpressure can only be applied to objects');
    }
    if (!Object.prototype.hasOwnProperty.call(this, '_cqsHighWaterMark')) {
      throw new TypeError('CountQueuingStrategy.prototype.shouldApplyBackpressure can only be applied to a ' +
        'CountQueuingStrategy');
    }

    return queueSize > this._cqsHighWaterMark;
  }

  size(chunk) {
    return 1;
  }
}
