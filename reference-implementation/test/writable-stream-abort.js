'use strict';
const test = require('tape-catch');

test('abort() on a released writer rejects', t => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.releaseLock();

  const abortPromise = writer.abort();
  abortPromise.then(() => {
    t.fail('abortPromise fulfilled unexpectedly');
    t.end();
  },
  r => {
    t.end();
  });
});

test('Aborting a WritableStream immediately prevents future writes', t => {
  const ws = new WritableStream({
    write() {
      t.fail('Unexpected write() call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    writer.abort();
    writer.write(1);
    writer.write(2);

    setTimeout(() => {
      t.end();
    }, 100);
  }, 0);
});

test('Aborting a WritableStream prevents further writes after any that are in progress', t => {
  t.plan(2);

  let writeCount = 0;

  const ws = new WritableStream({
    write(chunk) {
      ++writeCount;

      if (writeCount > 1) {
        t.fail('Only the single in-progress chunk gets written to the sink');
        t.end();
        return;
      }

      t.equals(chunk, 1, 'chunk should be 1');

      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    writer.write(1);
    writer.write(2);
    writer.write(3);
    writer.abort();
    writer.write(4);
    writer.write(5);

    setTimeout(function () {
      t.pass('Passed 200 ms');
    }, 200);
  }, 0);
});

test('Fulfillment value of ws.abort() call must be undefined even if the underlying sink returns a non-undefined value',
     t => {
  const ws = new WritableStream({
    abort() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const abortPromise = writer.abort('a');
  abortPromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('abortPromise is rejected');
    t.end();
  });
});

test('WritableStream if sink\'s abort throws, the promise returned by ws.abort() rejects', t => {
  const errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  const ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  const writer = ws.getWriter();

  const abortPromise = writer.abort(undefined);
  abortPromise.then(
    () => {
      t.fail('abortPromise is fulfilled unexpectedly');
      t.end();
    },
    r => {
      t.equal(r, errorInSinkAbort, 'rejection reason of abortPromise must be errorInSinkAbort');
      t.end();
    }
  );
});

test('Aborting a WritableStream passes through the given reason', t => {
  let recordedReason;
  const ws = new WritableStream({
    abort(reason) {
      recordedReason = reason;
    }
  });

  const writer = ws.getWriter();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  t.equal(recordedReason, passedReason);
  t.end();
});

test('Aborting a WritableStream puts it in an errored state, with stored error equal to the abort reason', t => {
  t.plan(5);

  let recordedReason;
  const ws = new WritableStream();

  const writer = ws.getWriter();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  t.equal(writer.state, 'errored', 'state should be errored');

  writer.write().then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  writer.close().then(
    () => t.fail('closing should not succeed'),
    r => t.equal(r, passedReason, 'closing should reject with the given reason')
  );

  writer.abort().then(
    () => t.fail('aborting a second time should not succeed'),
    r => t.equal(r, passedReason, 'aborting a second time should reject with the given reason')
  );

  writer.closed.then(
    () => t.fail('closed promise should not be fulfilled'),
    r => t.equal(r, passedReason, 'closed promise should be rejected with the given reason')
  );
});

test('Aborting a WritableStream causes any outstanding ready promises to be fulfilled immediately', t => {
  t.plan(2);

  let recordedReason;
  const ws = new WritableStream({
    write(chunk) {
      return new Promise(() => { }); // forever-pending, so normally .ready would not fulfill.
    }
  });

  const writer = ws.getWriter();

  writer.write('a');
  t.equal(writer.state, 'waiting', 'state should be waiting');

  writer.ready.then(() => {
    t.equal(writer.state, 'errored', 'state should now be errored');
  });

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);
});

test('Aborting a WritableStream causes any outstanding write() promises to be rejected with the abort reason', t => {
  t.plan(1);

  const ws = new WritableStream();

  const writer = ws.getWriter();

  writer.write('a').then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);
});

test('Closing but then immediately aborting a WritableStream causes the stream to error', t => {
  t.plan(2);

  const ws = new WritableStream();

  const writer = ws.getWriter();

  writer.close();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  writer.abort(passedReason);

  t.equal(writer.state, 'errored');

  writer.closed.then(
    () => t.fail('the stream should not close successfully'),
    r => t.equal(r, passedReason, 'the stream should be errored with the given reason')
  );
});

test('Closing a WritableStream and aborting it while it closes causes the stream to error', t => {
  t.plan(3);

  const ws = new WritableStream({
    close() {
      return new Promise(() => { }); // forever-pending
    }
  });

  const writer = ws.getWriter();

  writer.close();

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');

  setTimeout(() => {
    t.equal(writer.state, 'closing');

    writer.abort(passedReason);

    t.equal(writer.state, 'errored');
  }, 20);

  writer.closed.then(
    () => t.fail('the stream should not close successfully'),
    r => t.equal(r, passedReason, 'the stream should be errored with the given reason')
  );
});

test('Aborting a WritableStream after it is closed is a no-op', t => {
  t.plan(3);

  const ws = new WritableStream();

  const writer = ws.getWriter();

  writer.close();

  setTimeout(() => {
    t.equal(writer.state, 'closed');

    writer.abort().then(
      v => t.equal(v, undefined, 'abort promise should fulfill with undefined'),
      t.error
    );

    t.equal(writer.state, 'closed', 'state stays closed');
  }, 0);
});

test('WritableStream should call underlying sink\'s close if no abort is supplied', t => {
  t.plan(1);

  const ws = new WritableStream({
    close() {
      t.equal(arguments.length, 0, 'close() was called (with no arguments)');
    }
  });

  const writer = ws.getWriter();

  writer.abort();
});
