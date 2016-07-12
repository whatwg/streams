'use strict';
const glob = require('glob');
const path = require('path');

const { ReadableStream } = require('./lib/readable-stream.js');
const { WritableStream } = require('./lib/writable-stream.js');
const ByteLengthQueuingStrategy = require('./lib/byte-length-queuing-strategy.js');
const CountQueuingStrategy = require('./lib/count-queuing-strategy.js');
const TransformStream = require('./lib/transform-stream.js');

global.ReadableStream = ReadableStream;
global.WritableStream = WritableStream;
global.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
global.CountQueuingStrategy = CountQueuingStrategy;
global.TransformStream = TransformStream;

if (process.argv.length === 2) {
  const tests = glob.sync(path.resolve(__dirname, 'test/transform-stream.js'));
  tests.forEach(require);
} else {
  glob.sync(path.resolve(process.argv[2])).forEach(require);
}
