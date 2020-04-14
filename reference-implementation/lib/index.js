'use strict';
// This file is used as the entry point for browserifying the reference implementation to allow it
// to run inside the wpt-runner "browser like" context.

const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');
const { TransformStream } = require('./transform-stream.js');
const ByteLengthQueuingStrategy = require('../generated/ByteLengthQueuingStrategy.js');
const CountQueuingStrategy = require('../generated/CountQueuingStrategy.js');

window.ReadableStream = ReadableStream;
window.WritableStream = WritableStream;
window.TransformStream = TransformStream;
window.CountQueuingStrategy = CountQueuingStrategy;
window.gc = gc;

ByteLengthQueuingStrategy.install(window);
CountQueuingStrategy.install(window);
