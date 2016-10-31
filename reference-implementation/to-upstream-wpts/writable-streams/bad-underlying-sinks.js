'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/recording-streams.js');
}

const error1 = new Error('error1');
error1.name = 'error1';

promise_test(t => {

  const ws = recordingWritableStream({
    close() {
      throw error1;
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, error1, writer.close(), 'close() promise must reject with the thrown error')
  .then(() => promise_rejects(t, error1, writer.ready, 'ready promise must reject with the thrown error'))
  .then(() => promise_rejects(t, error1, writer.closed, 'closed promise must reject with the thrown error'))
  .then(() => {
    assert_array_equals(ws.events, ['close']);
  });

}, 'close: throwing method should cause writer close() and ready to reject');

promise_test(t => {

  const ws = recordingWritableStream({
    close() {
      return Promise.reject(error1);
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, error1, writer.close(), 'close() promise must reject with the same error')
  .then(() => promise_rejects(t, error1, writer.ready, 'ready promise must reject with the same error'))
  .then(() => {
    assert_array_equals(ws.events, ['close']);
  });

}, 'close: returning a rejected promise should cause writer close() and ready to reject');

promise_test(t => {

  const startPromise = Promise.resolve();
  let rejectSinkWritePromise;
  const ws = recordingWritableStream({
    start() {
      return startPromise;
    },
    write() {
      return new Promise((r, reject) => {
        rejectSinkWritePromise = reject;
      });
    }
  });

  return startPromise.then(() => {
    const writer = ws.getWriter();
    const writePromise = writer.write('a');
    rejectSinkWritePromise(error1);

    return Promise.all([
      promise_rejects(t, error1, writePromise, 'writer write must reject with the same error'),
      promise_rejects(t, error1, writer.ready, 'ready promise must reject with the same error')
    ]);
  })
  .then(() => {
    assert_array_equals(ws.events, ['write', 'a']);
  });

}, 'write: returning a promise that becomes rejected after the writer write() should cause writer write() and ready ' +
   'to reject');

promise_test(t => {

  const ws = recordingWritableStream({
    write() {
      if (ws.events.length === 2) {
        return delay(10);
      }

      return Promise.reject(error1);
    }
  });

  const writer = ws.getWriter();

  // Do not wait for this; we want to test the ready promise when the stream is "full" (desiredSize = 0), but if we wait
  // then the stream will transition back to "empty" (desiredSize = 1)
  writer.write('a');
  const readyPromise = writer.ready;

  return promise_rejects(t, error1, writer.write('b'), 'second write must reject with the same error').then(() => {
    assert_equals(writer.ready, readyPromise,
      'the ready promise must not change, since the queue was full after the first write, so the pending one simply ' +
      'transitioned');
    return promise_rejects(t, error1, writer.ready, 'ready promise must reject with the same error');
  })
  .then(() => {
    assert_array_equals(ws.events, ['write', 'a', 'write', 'b']);
  });

}, 'write: returning a rejected promise (second write) should cause writer write() and ready to reject');

done();
