'use strict';
// This file is used as the entry point for browserifying the reference implementation to allow it
// to run inside the wpt-runner "browser like" context.

// const { TransformStream } = require('./transform-stream.js');

// window.TransformStream = TransformStream;
window.gc = gc;

require('../generated/ByteLengthQueuingStrategy.js').install(window);
require('../generated/CountQueuingStrategy.js').install(window);

require('../generated/ReadableStream.js').install(window);
require('../generated/ReadableStreamDefaultReader.js').install(window);
require('../generated/ReadableStreamBYOBReader.js').install(window);
require('../generated/ReadableStreamDefaultController.js').install(window);
require('../generated/ReadableByteStreamController.js').install(window);
require('../generated/ReadableStreamBYOBRequest.js').install(window);

require('../generated/WritableStream.js').install(window);
require('../generated/WritableStreamDefaultWriter.js').install(window);
require('../generated/WritableStreamDefaultController.js').install(window);
