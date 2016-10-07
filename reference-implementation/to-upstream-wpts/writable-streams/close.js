'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

promise_test(t => {
  const ws = new WritableStream({
    close() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const closePromise = writer.close('a');
  return closePromise.then(value => assert_equals(value, undefined, 'fulfillment value must be undefined'));
}, 'fulfillment value of ws.close() call must be undefined even if the underlying sink returns a non-undefined ' +
    'value');

async_test(t => {
  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    close() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  promise_rejects(
      t, thrownError, writer.close(), 'close promise', 'close promise should be rejected with the thrown error');

  setTimeout(() => {
    promise_rejects(t, thrownError, writer.closed, 'closed', 'closed should stay rejected');
    t.done();
  }, 0);
}, 'when sink throws an error while closing, the stream should become errored');

async_test(t => {
  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  const writer = ws.getWriter();

  writer.close();
  setTimeout(() => controller.error(passedError), 10);

  promise_rejects(
      t, passedError, writer.closed, 'closed promise', 'closed promise should be rejected with the passed error');

  setTimeout(() => {
    promise_rejects(t, passedError, writer.closed, 'closed', 'closed should stay rejected');
    t.done();
  }, 70);
}, 'when sink calls error asynchronously while closing, the stream should become errored');

async_test(t => {
  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      controller.error(passedError);
    }
  });

  const writer = ws.getWriter();

  promise_rejects(
      t, passedError, writer.close(), 'close promise', 'close promise should be rejected with the passed error');

  setTimeout(() => {
    promise_rejects(t, passedError, writer.closed, 'closed', 'closed should stay rejected');
    t.done();
  }, 0);
}, 'when sink calls error synchronously while closing, the stream should become errored');
