'use strict';
const { createDataProperty } = require('./helpers.js');

module.exports = class CountQueuingStrategy {
  constructor({ highWaterMark }) {
    createDataProperty(this, 'highWaterMark', highWaterMark);
  }

  size() {
    return 1;
  }
};
