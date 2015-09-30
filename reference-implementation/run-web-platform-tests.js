// This runs the web platform tests against the reference implementation, in Node.js using jsdom, for easier rapid
// development of the reference implementation and the web platform tests.

const path = require("path");
const wptRunner = require("wpt-runner");

import ReadableStream from "./lib/readable-stream";
import WritableStream from "./lib/writable-stream";
import ByteLengthQueuingStrategy from "./lib/byte-length-queuing-strategy";
import CountQueuingStrategy from "./lib/count-queuing-strategy";

const testsPath = path.resolve(__dirname, "web-platform-tests");

wptRunner(testsPath, setup)
  .then(failures => process.exit(failures))
  .catch(e => {
    console.error(e.stack);
    process.exit(1);
  });

function setup(window) {
  window.ReadableStream = ReadableStream;
  window.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
  window.CountQueuingStrategy = CountQueuingStrategy;
}
