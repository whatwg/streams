'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js', '..resources/test-utils.js');
}

promise_test(t => {
  const ws = new WritableStream({
    close() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const closePromise = writer.close();
  return closePromise.then(value => assert_equals(value, undefined, 'fulfillment value must be undefined'));
}, 'fulfillment value of ws.close() call must be undefined even if the underlying sink returns a non-undefined ' +
    'value');

promise_test(t => {
  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      return delay(50);
    }
  });

  const writer = ws.getWriter();

  writer.close();

  return Promise.all([
    delay(10).then(() => controller.error(passedError)),
    promise_rejects(t, passedError, writer.closed,
                    'closed promise should be rejected with the passed error'),
    delay(70).then(() => promise_rejects(t, passedError, writer.closed, 'closed should stay rejected'))
  ]);
}, 'when sink calls error asynchronously while closing, the stream should become errored');

promise_test(t => {
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

  return promise_rejects(t, passedError, writer.close(), 'close promise should be rejected with the passed error')
      .then(() => promise_rejects(t, passedError, writer.closed, 'closed should stay rejected'));
}, 'when sink calls error synchronously while closing, the stream should become errored');
