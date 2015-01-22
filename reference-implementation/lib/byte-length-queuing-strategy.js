import { typeIsObject } from './helpers';

export default class ByteLengthQueuingStrategy {
  constructor({ highWaterMark }) {
    highWaterMark = Number(highWaterMark);

    if (Number.isNaN(highWaterMark)) {
      throw new TypeError('highWaterMark must be a number.');
    }
    if (highWaterMark < 0) {
      throw new RangeError('highWaterMark must be nonnegative.');
    }

    this._blqsHighWaterMark = highWaterMark;
  }

  shouldApplyBackpressure(queueSize) {
    if (!typeIsObject(this)) {
      throw new TypeError('ByteLengthQueuingStrategy.prototype.shouldApplyBackpressure can only be applied to objects');
    }
    if (!Object.prototype.hasOwnProperty.call(this, '_blqsHighWaterMark')) {
      throw new TypeError('ByteLengthQueuingStrategy.prototype.shouldApplyBackpressure can only be applied to a ' +
        'ByteLengthQueuingStrategy');
    }

    return queueSize > this._blqsHighWaterMark;
  }

  size(chunk) {
    return chunk.byteLength;
  }
}
