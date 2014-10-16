export default class ByteLengthQueuingStrategy {
  constructor({ highWaterMark }) {
    highWaterMark = Number(highWaterMark);

    if (Number.isNaN(highWaterMark)) {
      throw new TypeError('highWaterMark must be a number.');
    }
    if (highWaterMark < 0) {
      throw new RangeError('highWaterMark must be nonnegative.');
    }

    this.highWaterMark = highWaterMark;
  }

  shouldApplyBackpressure(queueSize) {
    return queueSize > this.highWaterMark;
  }

  size(chunk) {
    return chunk.byteLength;
  }
}
