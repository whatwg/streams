// This runs the web platform tests against the reference implementation, in Node.js using jsdom, for easier rapid
// development of the reference implementation and the web platform tests.
/* eslint-disable no-console*/
'use strict';
const path = require('path');
const wptRunner = require('wpt-runner');
const minimatch = require('minimatch');

const { ReadableStream } = require('./lib/readable-stream.js');
const { WritableStream } = require('./lib/writable-stream.js');
const { TransformStream } = require('./lib/transform-stream.js');
const ByteLengthQueuingStrategy = require('./lib/byte-length-queuing-strategy.js');
const CountQueuingStrategy = require('./lib/count-queuing-strategy.js');

const testsPath = path.resolve(__dirname, 'web-platform-tests/streams');

const filterGlobs = process.argv.length >= 3 ? process.argv.slice(2) : ['**/*.html'];
const workerTestPattern = /\.(?:dedicated|shared|service)worker(?:\.https)?\.html$/;
function filter(testPath) {
  return !workerTestPattern.test(testPath) && // ignore the worker versions
         filterGlobs.some(glob => minimatch(testPath, glob));
}

// wpt-runner does not yet support unhandled rejection tracking a la
// https://github.com/w3c/testharness.js/commit/7716e2581a86dfd9405a9c00547a7504f0c7fe94
// So we emulate it with Node.js events
const rejections = new Map();
process.on('unhandledRejection', (reason, promise) => {
  rejections.set(promise, reason);
});

process.on('rejectionHandled', promise => {
  rejections.delete(promise);
});

wptRunner(testsPath, { rootURL: 'streams/', setup, filter })
    .then(failures => {
      process.exitCode = failures;

      if (rejections.size > 0) {
        if (failures === 0) {
          process.exitCode = 1;
        }

        for (const reason of rejections.values()) {
          console.error('Unhandled promise rejection: ', reason.stack);
        }
      }
    })
    .catch(e => {
      console.error(e.stack);
      process.exitCode = 1;
    });

function setup(window) {
  // Necessary so that we can send test-realm promises to the jsdom-realm implementation without causing assimilation.
  window.Promise = Promise;

  window.ReadableStream = ReadableStream;
  window.WritableStream = WritableStream;
  window.TransformStream = TransformStream;
  window.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
  window.CountQueuingStrategy = CountQueuingStrategy;
}
