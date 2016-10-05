'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

promise_test(() => {
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    }
  });

  // Now error the stream after its construction.
  const passedError = new Error('horrible things');
  controller.error(passedError);

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, null, 'desiredSize should be null');
  return writer.closed.catch(r => {
    assert_equals(r, passedError, 'ws should be errored by passedError');
  });
}, 'controller argument should be passed to start method');

promise_test(() => {
  const ws = new WritableStream({}, {
    highWaterMark: 1000,
    size() { return 1; }
  });

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1000, 'desiredSize should be 1000');
  return writer.ready.then(v => {
    assert_equals(v, undefined, 'ready promise should fulfill with undefined');
  });
}, 'highWaterMark should be copied to desiredSize');

promise_test(() => {
  const ws = new WritableStream({}, {
    highWaterMark: Infinity,
    size() { return 0; }
  });

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, Infinity, 'desiredSize should be Infinity');

  return writer.ready;
}, 'WritableStream should be writable and ready should fulfill immediately if the strategy does not apply backpressure');

test(() => {
  const ws = new WritableStream();
}, 'WritableStream should be constructible with no arguments');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();

  assert_equals(typeof writer.write, 'function', 'writer should have a write method');
  assert_equals(typeof writer.abort, 'function', 'writer should have an abort method');
  assert_equals(typeof writer.close, 'function', 'writer should have a close method');

  assert_equals(writer.desiredSize, 1, 'desiredSize should start at 1');

  assert_idl_attribute(writer, 'ready', 'writer should have a ready attribute');
  assert_equals(typeof writer.ready.then, 'function', 'ready attribute should be thenable');
  assert_idl_attribute(writer, 'closed', 'writer should have a closed attribute');
  assert_equals(typeof writer.closed.then, 'function', 'closed attribute should be thenable');
}, 'WritableStream instances should have standard methods and properties');
