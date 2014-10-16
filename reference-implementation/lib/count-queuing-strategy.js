export default class CountQueuingStrategy {
  constructor({ highWaterMark }) {
    highWaterMark = Number(highWaterMark);

    if (Number.isNaN(highWaterMark)) {
      throw new TypeError('highWaterMark must be a number.');
    }
    if (highWaterMark < 0) {
      throw new RangeError('highWaterMark must be nonnegative.');
    }

    this._highWaterMark = highWaterMark;
  }

  shouldApplyBackpressure(queueSize) {
    return queueSize > this._highWaterMark;
  }

  size(chunk) {
    return 1;
  }
}
