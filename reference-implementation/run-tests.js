const glob = require('glob');
const path = require('path');

import ReadableStream from './lib/readable-stream';
import WritableStream from './lib/writable-stream';
import ReadableByteStream from './lib/experimental/readable-byte-stream';
import ByteLengthQueuingStrategy from './lib/byte-length-queuing-strategy';
import CountQueuingStrategy from './lib/count-queuing-strategy';
import TransformStream from './lib/transform-stream';

global.ReadableStream = ReadableStream;
global.WritableStream = WritableStream;
global.ReadableByteStream = ReadableByteStream;
global.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
global.CountQueuingStrategy = CountQueuingStrategy;
global.TransformStream = TransformStream;


//const tests = glob.sync(path.resolve(__dirname, 'test/*.js'));
//const experimentalTests = glob.sync(path.resolve(__dirname, 'test/experimental/*.js'));
//tests.concat(experimentalTests).forEach(require);
glob.sync(path.resolve(__dirname, 'test/experimental/operation-stream.js')).forEach(require);
