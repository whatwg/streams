'use strict';
const { createDataProperty } = require('./helpers.js');

module.exports = class ByteLengthQueuingStrategy {
  constructor({ highWaterMark }) {
    createDataProperty(this, 'highWaterMark', highWaterMark);
  }

  size(chunk) {
    return chunk.byteLength;
  }
};
