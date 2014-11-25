var test = require('tape');

import WritableStream from '../lib/writable-stream';

test('Aborting a WritableStream immediately prevents future writes', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk) {
      chunks.push(chunk);
    }
  });

  setTimeout(() => {
    ws.abort();
    ws.write(1);
    ws.write(2);
    t.deepEqual(chunks, [], 'no chunks are written');
    t.end();
  }, 0);
});

test('Aborting a WritableStream prevents further writes after any that are in progress', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk) {
      chunks.push(chunk);
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  setTimeout(() => {
    ws.write(1);
    ws.write(2);
    ws.write(3);
    ws.abort();
    ws.write(4);
    ws.write(5);

    setTimeout(function () {
      t.deepEqual(chunks, [1], 'only the single in-progress chunk gets written');
      t.end();
    }, 200);
  }, 0);
});

test(`Fulfillment value of ws.abort() call must be undefined even if the underlying sink returns a
 non-undefined value`, t => {
  var ws = new WritableStream({
    abort() {
      return 'Hello';
    }
  });

  var abortPromise = ws.abort('a');
  abortPromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('abortPromise is rejected');
    t.end();
  });
});

test('WritableStream if sink\'s abort throws, the promise returned by ws.abort() rejects', t => {
  var errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  var ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  var abortPromise = ws.abort(undefined);
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
  var recordedReason;
  var ws = new WritableStream({
    abort(reason) {
      recordedReason = reason;
    }
  });

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);

  t.equal(recordedReason, passedReason);
  t.end();
});

test('Aborting a WritableStream puts it in an errored state, with stored error equal to the abort reason', t => {
  t.plan(6);

  var recordedReason;
  var ws = new WritableStream();

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);

  t.equal(ws.state, 'errored', 'state should be errored');

  ws.write().then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  ws.ready.then(
    () => t.fail('ready should not succeed'),
    r => t.equal(r, passedReason, 'ready should reject with the given reason')
  );

  ws.close().then(
    () => t.fail('closing should not succeed'),
    r => t.equal(r, passedReason, 'closing should reject with the given reason')
  );

  ws.abort().then(
    () => t.fail('aborting a second time should not succeed'),
    r => t.equal(r, passedReason, 'aborting a second time should reject with the given reason')
  );

  ws.closed.then(
    () => t.fail('closed promise should not be fulfilled'),
    r => t.equal(r, passedReason, 'closed promise should be rejected with the given reason')
  );
});

test('Aborting a WritableStream causes any outstanding ready promises to be rejected with the abort reason', t => {
  t.plan(2);

  var recordedReason;
  var ws = new WritableStream({});
  ws.write('a');
  t.equal(ws.state, 'waiting', 'state should be waiting');

  ws.ready.then(
    () => t.fail('ready should not succeed'),
    r => t.equal(r, passedReason, 'ready should reject with the given reason')
  );

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);
});

test('Aborting a WritableStream causes any outstanding write() promises to be rejected with the abort reason', t => {
  t.plan(1);

  var ws = new WritableStream();

  ws.write('a').then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);
});

test('Closing but then immediately aborting a WritableStream causes the stream to error', t => {
  t.plan(2);

  var ws = new WritableStream();

  ws.close();

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);

  t.equal(ws.state, 'errored');

  ws.closed.then(
    () => t.fail('the stream should not close successfully'),
    r => t.equal(r, passedReason, 'the stream should be errored with the given reason')
  );
});

test('Closing a WritableStream and aborting it while it closes causes the stream to error', t => {
  t.plan(3);

  var ws = new WritableStream({
    close() {
      return new Promise(() => {}); // forever-pending
    }
  });

  ws.close();

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');

  setTimeout(() => {
    t.equal(ws.state, 'closing');

    ws.abort(passedReason);

    t.equal(ws.state, 'errored');
  }, 20);

  ws.closed.then(
    () => t.fail('the stream should not close successfully'),
    r => t.equal(r, passedReason, 'the stream should be errored with the given reason')
  );
});

test('Aborting a WritableStream after it is closed is a no-op', t => {
  t.plan(3);

  var ws = new WritableStream();

  ws.close();

  setTimeout(() => {
    t.equal(ws.state, 'closed');

    ws.abort().then(
      v => t.equal(v, undefined, 'abort promise should fulfill with undefined'),
      t.error
    );

    t.equal(ws.state, 'closed', 'state stays closed');
  }, 0);
});
