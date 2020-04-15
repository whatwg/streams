'use strict';
// This file is used as the entry point for browserifying the reference implementation to allow it
// to run inside the wpt-runner "browser like" context.

// const { ReadableStream } = require('./readable-stream.js');
// const { TransformStream } = require('./transform-stream.js');

// window.ReadableStream = ReadableStream;
// window.TransformStream = TransformStream;
window.gc = gc;

require('../generated/ByteLengthQueuingStrategy.js').install(window);
require('../generated/CountQueuingStrategy.js').install(window);
require('../generated/WritableStream.js').install(window);
require('../generated/WritableStreamDefaultController.js').install(window);
require('../generated/WritableStreamDefaultWriter.js').install(window);
