'use strict';

global.ReadableStream = require('./lib/readable-stream.js');
global.WritableStream = require('./lib/writable-stream.js');

global.TeeStream = function () {};
global.ByteLengthQueuingStrategy = function () {};
global.CountQueuingStrategy = function () {};
