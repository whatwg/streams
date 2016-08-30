'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

test(() => {
  const ws = new WritableStream({});
  const writer = ws.getWriter();
  writer.releaseLock();

  assert_throws(new TypeError, () => writer.desiredSize, 'desiredSize should throw a TypeError');
}, 'desiredSize on a released writer');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');
}, 'desiredSize initial value');

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();

  writer.close();

  return writer.closed.then(() => {
    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');
  });
}, 'desiredSize on a writer for a closed stream');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.close();
  writer.releaseLock();

  ws.getWriter();
}, 'ws.getWriter() on a closing WritableStream');

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  return writer.close().then(() => {
    writer.releaseLock();

    ws.getWriter();
  })
}, 'ws.getWriter() on a closed WritableStream');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.abort();
  writer.releaseLock();

  ws.getWriter();
}, 'ws.getWriter() on an aborted WritableStream');

test(() => {
  const ws = new WritableStream({
    start(c) {
      c.error();
    }
  });

  const writer = ws.getWriter();
  return writer.closed.then(
    v => assert_unreached('writer.closed fulfilled unexpectedly with: ' + v),
    () => {
      writer.releaseLock();

      ws.getWriter();
    }
  );
}, 'ws.getWriter() on an errored WritableStream');
