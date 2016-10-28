'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/recording-streams.js');
}

promise_test(() => {
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
    close(c) {
      controller = c;
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
  const ws = new WritableStream({
    close(controller) {
      controller.error(passedError);
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, passedError, writer.close(), 'close promise should be rejected with the passed error')
      .then(() => promise_rejects(t, passedError, writer.closed, 'closed should stay rejected'));
}, 'when sink calls error synchronously while closing, the stream should become errored');

promise_test(() => {
  const ws = recordingWritableStream();

  const writer = ws.getWriter();

  return writer.ready.then(() => {
    assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

    writer.close();
    assert_equals(writer.desiredSize, 1, 'desiredSize should be still 1');

    return writer.ready.then(v => {
      assert_equals(v, undefined, 'ready promise should be fulfilled with undefined');
      assert_array_equals(ws.events, ['close'], 'write and abort should not be called');
    });
  });
}, 'when close is called on a WritableStream in writable state, ready should return a fulfilled promise');

promise_test(() => {
  const ws = recordingWritableStream({
    write() {
      return new Promise(() => {});
    }
  });

  const writer = ws.getWriter();

  return writer.ready.then(() => {
    writer.write('a');

    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');

    let calledClose = false;
    return Promise.all([
      writer.ready.then(v => {
        assert_equals(v, undefined, 'ready promise should be fulfilled with undefined');
        assert_true(calledClose, 'ready should not be fulfilled before writer.close() is called');
        assert_array_equals(ws.events, ['write', 'a'], 'sink abort() should not be called');
      }),
      delay(100).then(() => {
        writer.close();
        calledClose = true;
      })
    ]);
  });
}, 'when close is called on a WritableStream in waiting state, ready promise should be fulfilled');

promise_test(() => {
  let asyncCloseFinished = false;
  const ws = recordingWritableStream({
    close() {
      return delay(50).then(() => {
        asyncCloseFinished = true;
      });
    }
  });

  const writer = ws.getWriter();
  return writer.ready.then(() => {
    writer.write('a');

    writer.close();

    return writer.ready.then(v => {
      assert_false(asyncCloseFinished, 'ready promise should be fulfilled before async close completes');
      assert_equals(v, undefined, 'ready promise should be fulfilled with undefined');
      assert_array_equals(ws.events, ['write', 'a', 'close'], 'sink abort() should not be called');
    });
  });
}, 'when close is called on a WritableStream in waiting state, ready should be fulfilled immediately even if close ' +
    'takes a long time');

promise_test(t => {
  const rejection = { name: 'letter' };
  const ws = new WritableStream({
    close() {
      return {
        then(onFulfilled, onRejected) { onRejected(rejection); }
      };
    }
  });
  return promise_rejects(t, rejection, ws.getWriter().close(), 'close() should return a rejection');
}, 'returning a thenable from close() should work');
