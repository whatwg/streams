// This runs the web platform tests against the reference implementation, in Node.js using jsdom, for easier rapid
// development of the reference implementation and the web platform tests.
'use strict';
const path = require('path');
const wptRunner = require('wpt-runner');

const { ReadableStream } = require('./lib/readable-stream.js');
const { WritableStream } = require('./lib/writable-stream.js');
const ByteLengthQueuingStrategy = require('./lib/byte-length-queuing-strategy.js');
const CountQueuingStrategy = require('./lib/count-queuing-strategy.js');

const testsPath = path.resolve(__dirname, 'web-platform-tests/streams');
const toUpstreamTestsPath = path.resolve(__dirname, 'to-upstream-wpts');

wptRunner(toUpstreamTestsPath, { rootURL: 'streams/', setup })
  .then(() => wptRunner(testsPath, { rootURL: 'streams/', setup }))
  .then(failures => process.exit(failures))
  .catch(e => {
    console.error(e.stack);
    process.exit(1);
  });

function setup(window) {
  // Necessary so that we can send test-realm promises to the jsdom-realm implementation without causing assimilation.
  window.Promise = Promise;

  window.ReadableStream = ReadableStream;
  window.WritableStream = WritableStream;
  window.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
  window.CountQueuingStrategy = CountQueuingStrategy;
}
