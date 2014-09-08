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

  ws.wait().then(
    () => t.fail('waiting should not succeed'),
    r => t.equal(r, passedReason, 'waiting should reject with the given reason')
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

test('Aborting a WritableStream causes any outstanding wait() promises to be rejected with the abort reason', t => {
  t.plan(2);

  var recordedReason;
  var ws = new WritableStream({});
  ws.write('a');
  t.equal(ws.state, 'waiting', 'state should be waiting');

  ws.wait().then(
    () => t.fail('waiting should not succeed'),
    r => t.equal(r, passedReason, 'waiting should reject with the given reason')
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
