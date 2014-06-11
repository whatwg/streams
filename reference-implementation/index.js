'use strict';

global.ReadableStream = require('./lib/readable-stream.js');

global.BaseWritableStream = require('./lib/base-writable.js');
global.WritableStream = function () {};

global.TeeStream = function () {};
global.ByteLengthQueuingStrategy = function () {};
global.CountQueuingStrategy = function () {};
