// This runs the web platform tests against the reference implementation, in Node.js using jsdom, for easier rapid
// development of the reference implementation and the web platform tests.
/* eslint-disable no-console */
'use strict';
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const wptRunner = require('wpt-runner');
const { minimatch } = require('minimatch');
const readFileAsync = promisify(fs.readFile);

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

main().catch(e => {
  console.error(e.stack);
  process.exitCode = 1;
});

async function main() {
  const bundlePath = path.resolve(__dirname, 'bundle.js');
  const wptPath = path.resolve(__dirname, 'web-platform-tests');
  const testsPath = path.resolve(wptPath, 'streams');

  const filterGlobs = process.argv.length >= 3 ? process.argv.slice(2) : ['**/*.html'];
  const excludeGlobs = [
    'piping/general-addition.any.html', // FIXME: reenable this test as part of https://github.com/whatwg/streams/issues/1243.
    // These tests use ArrayBuffers backed by WebAssembly.Memory objects, which *should* be non-transferable.
    // However, our TransferArrayBuffer implementation cannot detect these, and will incorrectly "transfer" them anyway.
    'readable-byte-streams/non-transferable-buffers.any.html',
    'readable-streams/owning-type-message-port.any.html', // disabled due to MessagePort use.
    'readable-streams/owning-type-video-frame.any.html', // disabled due to VideoFrame use.
    'readable-streams/owning-type.any.html', // FIXME: reenable this test once owning type PR lands.
    'transferable/transform-stream-members.any.html' // FIXME: reenable if structuredClone is aligned.
  ];
  const anyTestPattern = /\.any\.html$/;

  let bundledJS = await readFileAsync(bundlePath, { encoding: 'utf8' });
  bundledJS = `${bundledJS}\n//# sourceURL=file://${bundlePath}`;

  const failures = await wptRunner(testsPath, {
    rootURL: 'streams/',
    setup(window) {
      window.queueMicrotask = queueMicrotask;
      window.structuredClone = globalThis.structuredClone;
      window.fetch = async function (url) {
        const filePath = path.join(wptPath, url);
        if (!filePath.startsWith(wptPath)) {
          throw new TypeError('Invalid URL');
        }
        return {
          ok: true,
          async text() {
            return await readFileAsync(filePath, { encoding: 'utf8' });
          }
        };
      };
      window.eval(bundledJS);
    },
    filter(testPath) {
      // Ignore the window-specific and worker-specific tests
      if (!anyTestPattern.test(testPath)) {
        return false;
      }

      return filterGlobs.some(glob => minimatch(testPath, glob)) &&
        !excludeGlobs.some(glob => minimatch(testPath, glob));
    }
  });

  process.exitCode = failures;

  if (rejections.size > 0) {
    if (failures === 0) {
      process.exitCode = 1;
    }

    for (const reason of rejections.values()) {
      console.error('Unhandled promise rejection: ', reason.stack);
    }
  }
}
