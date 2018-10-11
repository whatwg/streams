'use strict';
// This file is used as the entry point for browserifying the reference implementation to allow it
// to run inside the wpt-runner "browser like" context.

const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');
const { TransformStream } = require('./transform-stream.js');
const ByteLengthQueuingStrategy = require('./byte-length-queuing-strategy.js');
const CountQueuingStrategy = require('./count-queuing-strategy.js');

window.ReadableStream = ReadableStream;
window.WritableStream = WritableStream;
window.TransformStream = TransformStream;
window.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
window.CountQueuingStrategy = CountQueuingStrategy;
window.gc = gc;
