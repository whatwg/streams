var test = require('tape');

import WritableStream from '../lib/writable-stream';

test('Aborting a WritableStream immediately prevents future writes', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk, done) {
      chunks.push(chunk);
      done();
    }
  });

  ws.abort();
  ws.write(1);
  ws.write(2);

  t.deepEqual(chunks, [], 'no chunks are written');
  t.end();
});

test('Aborting a WritableStream prevents further writes after any that are in progress', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk, done) {
      chunks.push(chunk);
      setTimeout(done, 50);
    }
  });

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
  var ws = new WritableStream({
    write(chunk, done) {
      done();
    }
  });

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
  t.plan(1);

  var recordedReason;
  var ws = new WritableStream({
    write(chunk, done) {
      done();
    }
  });

  ws.wait().then(
    () => t.fail('waiting should not succeed'),
    r => t.equal(r, passedReason, 'waiting should reject with the given reason')
  );

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);
});
