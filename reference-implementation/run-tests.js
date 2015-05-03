const glob = require('glob');
const path = require('path');

import ReadableStream from './lib/readable-stream';
import WritableStream from './lib/writable-stream';
import ByteLengthQueuingStrategy from './lib/byte-length-queuing-strategy';
import CountQueuingStrategy from './lib/count-queuing-strategy';
import TransformStream from './lib/transform-stream';

global.ReadableStream = ReadableStream;
global.WritableStream = WritableStream;
global.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
global.CountQueuingStrategy = CountQueuingStrategy;
global.TransformStream = TransformStream;


if (process.argv.length === 2) {
  const tests = glob.sync(path.resolve(__dirname, 'test/*.js'));

  tests.forEach(require);
} else {
    glob.sync(path.resolve(process.argv[2])).forEach(require);
}
