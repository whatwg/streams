'use strict';
const { invoke } = require('../webidl-helpers.js');

exports.ExtractHighWaterMark = (strategy, defaultHWM) => {
  if (!('highWaterMark' in strategy)) {
    return defaultHWM;
  }

  const { highWaterMark } = strategy;
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('Invalid highWaterMark');
  }

  return highWaterMark;
};

exports.ExtractSizeAlgorithm = strategy => {
  if (!('size' in strategy)) {
    return () => 1;
  }

  return chunk => {
    // TODO: manual number conversion won't be necessary when https://github.com/jsdom/webidl2js/pull/123 lands.
    return Number(invoke(strategy.size, [chunk]));
  };
};
