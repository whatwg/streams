'use strict';

if (self.importScripts) {
  self.importScripts('../resources/test-utils.js');
  self.importScripts('/resources/testharness.js');
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

function promise_fulfills(expectedValue, promise, msg) {
  promise.then(value => {
    assert_equals(value, expectedValue, msg);
  }, reason => {
    throw new Error(msg + ': Rejected unexpectedly with: ' + reason);
  });
}

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.releaseLock();

  const abortPromise = writer.abort();
  return abortPromise.then(() => {
    throw new Error('abortPromise fulfilled unexpectedly');
  },
  r => {
    assert_equals(r.constructor.toString(), TypeError.toString(), 'abort() should reject with a TypeError');
  });
}, 'abort() on a released writer rejects');

promise_test(() => {
  const ws = new WritableStream({
    write() {
      throw new Error('Unexpected write() call');
    }
  });

  return delay(0).then(() => {
    const writer = ws.getWriter();

    writer.abort();
    writer.write(1);
    writer.write(2);
  })
  .then(() => delay(100));
}, 'Aborting a WritableStream immediately prevents future writes');

promise_test(() => {
  let writeCount = 0;

  const ws = new WritableStream({
    write(chunk) {
      ++writeCount;

      if (writeCount > 1) {
        const err = new Error('Only the single in-progress chunk gets written to the sink');
        return Promise.reject(err);
      }

      assert_equals(chunk, 1, 'chunk should be 1');

      return delay(50);
    }
  });

  return delay(0).then(() => {
    const writer = ws.getWriter();

    writer.write(1);
    writer.write(2);
    writer.write(3);
    writer.abort();
    writer.write(4);
    writer.write(5);

    return delay(200);
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

promise_test(() => {
  const errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  const ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  const writer = ws.getWriter();

  const abortPromise = writer.abort(undefined);
  return abortPromise.then(
    () => {
      throw new Error('abortPromise is fulfilled unexpectedly');
    },
    r => {
      assert_equals(r, errorInSinkAbort, 'rejection reason of abortPromise must be errorInSinkAbort');
    }
  );
}, 'WritableStream if sink\'s abort throws, the promise returned by writer.abort() rejects');

promise_test(() => {
  const errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  const ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  const abortPromise = ws.abort(undefined);
  return abortPromise.then(
    () => {
      throw new Error('abortPromise is fulfilled unexpectedly');
    },
    r => {
      assert_equals(r, errorInSinkAbort, 'rejection reason of abortPromise must be errorInSinkAbort');
    }
  );
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

promise_test(() => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  return Promise.all([
    writer.write().then(
      () => { throw new Error('writing should not succeed'); },
      r => assert_equals(r.constructor.toString(), TypeError.toString(), 'writing should reject with the given reason')
    ),
    writer.close().then(
      () => { throw new Error('closing should not succeed'); },
      r => assert_equals(r.constructor.toString(), TypeError.toString(), 'closing should reject with the given reason')
    ),
    writer.abort().then(
      () => { throw new Error('aborting a second time should not succeed'); },
      r => assert_equals(r.constructor.toString(), TypeError.toString(), 'aborting a second time should reject ' +
        'with the given reason')
    ),
    writer.closed.then(
      () => { throw new Error('closed fulfilled unexpectedly'); },
      r => assert_equals(r.constructor.toString(), TypeError.toString(), 'closed should reject with a TypeError')
    )
  ]);
}, 'Aborting a WritableStream puts it in an errored state, with stored error equal to the abort reason');

test(() => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  writer.write('a').then(
    () => { throw new Error('writing should not succeed'); },
    r => assert_equals(r.constructor, TypeError, 'writing should reject with a TypeError')
  );

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);
}, 'Aborting a WritableStream causes any outstanding write() promises to be rejected with the abort reason');

promise_test(() => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  writer.close();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  return writer.closed.then(
    () => { throw new Error('the stream should not close successfully'); },
    r => assert_equals(r.constructor.toString(), TypeError.toString(), 'the stream should be errored with a TypeError')
  );
}, 'Closing but then immediately aborting a WritableStream causes the stream to error');

promise_test(() => {
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

  return writer.closed.then(
    () => { throw new Error('the stream should not close successfully'); },
    r => {
      assert_equals(r.constructor.toString(), TypeError.toString(), 'the stream should be errored with a TypeError');
    }
  );
}, 'Closing a WritableStream and aborting it while it closes causes the stream to error');

test(() => {
  const ws = new WritableStream();
  const writer = ws.getWriter();

  writer.close();

  setTimeout(() => {
    writer.abort().then(
      v => assert_equals(v, undefined, 'abort promise should fulfill with undefined'),
      () => { throw new Error(); }
    );

    promise_fulfills(undefined, writer.closed, 'closed should still be fulfilled');
  }, 0);
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
