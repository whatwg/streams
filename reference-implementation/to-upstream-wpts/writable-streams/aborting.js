'use strict';
/* global delay, recordingWritableStream */

if (self.importScripts) {
  self.importScripts('../resources/test-utils.js');
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/recording-streams.js');
}

const error1 = new Error('error1');
error1.name = 'error1';

promise_test(t => {
  const ws = new WritableStream({
    write() {
      return new Promise(() => { }); // forever-pending, so normally .ready would not fulfill.
    }
  });

  const writer = ws.getWriter();
  writer.write('a');

  const readyPromise = writer.ready;

  writer.abort(error1);

  assert_equals(writer.ready, readyPromise, 'the ready promise property should not change');

  return promise_rejects(t, new TypeError(), readyPromise, 'the ready promise should reject with a TypeError');
}, 'Aborting a WritableStream should cause the writer\'s unsettled ready promise to reject');

promise_test(t => {
  const ws = new WritableStream();

  const writer = ws.getWriter();
  writer.write('a');

  const readyPromise = writer.ready;

  return readyPromise.then(() => {
    writer.abort(error1);

    assert_not_equals(writer.ready, readyPromise, 'the ready promise property should change');
    return promise_rejects(t, new TypeError(), writer.ready, 'the ready promise should reject with a TypeError');
  });
}, 'Aborting a WritableStream should cause the writer\'s fulfilled ready promise to reset to a rejected one');

promise_test(t => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.releaseLock();

  return promise_rejects(t, new TypeError(), writer.abort(), 'abort() should reject with a TypeError');
}, 'abort() on a released writer rejects');

promise_test(() => {
  const ws = recordingWritableStream();

  return delay(0)
    .then(() => {
      const writer = ws.getWriter();

      writer.abort();
      writer.write(1);
      writer.write(2);
    })
    .then(() => {
      assert_equals(ws.events.length, 2, 'the stream should have received 2 events');
      assert_equals(ws.events[0], 'abort', 'abort should be called first');
      assert_equals(ws.events[1], undefined, 'no further writes should have happened');
    });
}, 'Aborting a WritableStream immediately prevents future writes');

promise_test(() => {
  const ws = recordingWritableStream();

  return delay(0)
    .then(() => {
      const writer = ws.getWriter();

      writer.write(1);
      writer.write(2);
      writer.write(3);
      writer.abort();
      writer.write(4);
      writer.write(5);
    }).then(() => {
      assert_equals(ws.events.length, 4, 'the stream should have received 4 events');
      assert_equals(ws.events[1], 1, 'chunk should be 1');
      assert_equals(ws.events[2], 'abort', 'abort should be called after write');
      assert_equals(ws.events[3], undefined, 'no further writes should have happened');
    });
}, 'Aborting a WritableStream prevents further writes after any that are in progress');

promise_test(() => {
  const ws = new WritableStream({
    abort() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const abortPromise = writer.abort('a');
  return abortPromise.then(value => {
    assert_equals(value, undefined, 'fulfillment value must be undefined');
  });
}, 'Fulfillment value of ws.abort() call must be undefined even if the underlying sink returns a non-undefined value');

promise_test(t => {
  const errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  const ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, errorInSinkAbort, writer.abort(undefined),
    'rejection reason of abortPromise must be errorInSinkAbort');
}, 'WritableStream if sink\'s abort throws, the promise returned by writer.abort() rejects');

promise_test(t => {
  const errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  const ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  return promise_rejects(t, errorInSinkAbort, ws.abort(undefined),
    'rejection reason of abortPromise must be errorInSinkAbort');
}, 'WritableStream if sink\'s abort throws, the promise returned by ws.abort() rejects');

test(() => {
  let recordedReason;
  const ws = new WritableStream({
    abort(reason) {
      recordedReason = reason;
    }
  });

  const writer = ws.getWriter();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  assert_equals(recordedReason, passedReason);
}, 'Aborting a WritableStream passes through the given reason');

promise_test(t => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  return Promise.all([
    promise_rejects(t, new TypeError(), writer.write(), 'writing should reject with the given reason'),
    promise_rejects(t, new TypeError(), writer.close(), 'closing should reject with the given reason'),
    promise_rejects(t, new TypeError(), writer.abort(), 'aborting should reject with the given reason'),
    promise_rejects(t, new TypeError(), writer.closed, 'closed should reject with the given reason'),
  ]);
}, 'Aborting a WritableStream puts it in an errored state, with stored error equal to the abort reason');

// TODO return promise
promise_test(t => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  promise_rejects(t, new TypeError(), writer.write('a'), 'writing should reject with a TypeError');

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);
}, 'Aborting a WritableStream causes any outstanding write() promises to be rejected with the abort reason');

promise_test(t => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  writer.close();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  return promise_rejects(t, new TypeError('Aborted'), writer.closed, 'the stream should be errored with a TypeError');
}, 'Closing but then immediately aborting a WritableStream causes the stream to error');

promise_test(t => {
  const ws = new WritableStream({
    close() {
      return new Promise(() => { }); // forever-pending
    }
  });

  const writer = ws.getWriter();

  writer.close();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');

  setTimeout(() => {
    writer.abort(passedReason);
  }, 20);

  return promise_rejects(t, new TypeError(), writer.closed, 'the stream should be errored with a TypeError');
}, 'Closing a WritableStream and aborting it while it closes causes the stream to error');

promise_test(() => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  writer.close();

  return delay(0)
    .then(() => writer.abort())
    .then(
      v => assert_equals(v, undefined, 'abort promise should fulfill with undefined'),
      () => { throw new Error(); }
    );
}, 'Aborting a WritableStream after it is closed is a no-op');

test(() => {
  const ws = new WritableStream({
    close(...args) {
      assert_equals(args.length, 0, 'close() was called (with no arguments)');
    }
  });

  const writer = ws.getWriter();

  writer.abort();
}, 'WritableStream should call underlying sink\'s close if no abort is supplied');
