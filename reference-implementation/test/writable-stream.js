var test = require('tape');

import WritableStream from '../lib/writable-stream';

function writeArrayToStream(array, writableStream) {
  array.forEach(chunk => writableStream.write(chunk));
  return writableStream.close();
}

test('WritableStream can be constructed with no arguments', t => {
  t.plan(1);
  t.doesNotThrow(() => new WritableStream(), 'WritableStream constructed with no errors');
});

test('WritableStream instances have the correct methods and properties', t => {
  t.plan(7);

  var ws = new WritableStream();

  t.equal(typeof ws.write, 'function', 'has a write method');
  t.equal(typeof ws.wait, 'function', 'has a wait method');
  t.equal(typeof ws.abort, 'function', 'has an abort method');
  t.equal(typeof ws.close, 'function', 'has a close method');

  t.equal(ws.state, 'writable', 'state starts out writable');

  t.ok(ws.closed, 'has a closed property');
  t.ok(ws.closed.then, 'closed property is thenable');
});

test('WritableStream with simple input, processed asynchronously', t => {
  t.plan(1);

  var storage;
  var ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk, done) {
      setTimeout(() => {
        storage.push(chunk);
        done();
      }, 0);
    },

    close() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream with simple input, processed synchronously', t => {
  t.plan(1);

  var storage;
  var ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk, done) {
      storage.push(chunk);
      done();
    },
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream stays writable indefinitely if writes are all acknowledged synchronously', t => {
  t.plan(10);

  var ws = new WritableStream({
    write(chunk, done) {
      t.equal(this.state, 'waiting', 'state is waiting before writing ' + chunk);
      done();
      t.equal(this.state, 'writable', 'state is writable after writing ' + chunk);
    }
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.end(),
    r => t.fail(r)
  );
});

test('WritableStream transitions to waiting after one write that is not synchronously acknowledged', t => {
  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      done = done_;
    }
  });

  t.strictEqual(ws.state, 'writable', 'state starts writable');
  ws.write('a');
  t.strictEqual(ws.state, 'waiting', 'state is waiting until the write finishes');
  done();
  t.strictEqual(ws.state, 'writable', 'state becomes writable again after the write finishes');

  t.end();
});

test('WritableStream if sink calls error, queued write and close are cleared', t => {
  t.plan(6);

  var error;
  var ws = new WritableStream({
    write(chunk, done, error_) {
      error = error_;
    }
  });

  var writePromise = ws.write('a');

  t.notStrictEqual(error, undefined, 'write is called and error is set');

  var writePromise2 = ws.write('b');
  var closedPromise = ws.close();

  t.strictEqual(ws.state, 'closing', 'state is closing until the close finishes');

  var passedError = new Error('horrible things');
  error(passedError);

  t.strictEqual(ws.state, 'errored', 'state is errored as the sink called error');

  writePromise.then(
    () => t.fail('writePromise is fulfilled unexpectedly'),
    r => t.strictEqual(r, passedError)
  );

  writePromise2.then(
    () => t.fail('writePromise2 is fulfilled unexpectedly'),
    r => t.strictEqual(r, passedError)
  );

  closedPromise.then(
    () => t.fail('closedPromise is fulfilled unexpectedly'),
    r => t.strictEqual(r, passedError)
  );
});

test('WritableStream if sink calls error, wait will return a rejected promise', t => {
  t.plan(3);

  var error;
  var ws = new WritableStream({
    write(chunk, done, error_) {
      done();
      error = error_;
    }
  });
  ws.write('a');
  t.strictEqual(ws.state, 'writable', 'state is writable as signalDone is called');

  var passedError = new Error('pass me');
  error(passedError);
  t.strictEqual(ws.state, 'errored', 'state is errored as error is called');

  ws.wait().then(
    () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
    r => t.strictEqual(r, passedError, 'wait() should be rejected with the passed error')
  );
});

test('WritableStream if sink throws an error after done, the stream becomes errored but the promise fulfills', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    write(chunk, done) {
      done();
      throw thrownError;
    }
  });

  var writePromise = ws.write('a');
  t.strictEqual(ws.state, 'errored', 'state is errored after the sink throws');

  var closedPromise = ws.close();

  writePromise.then(
    () => t.pass('the promise returned from write should fulfill since done was called before throwing'),
    t.ifError
  );

  ws.close().then(
    () => t.fail('close() is fulfilled unexpectedly'),
    r => t.strictEqual(r, thrownError, 'close() should be rejected with the thrown error')
  );
});

test('WritableStream if sink throws an error before done, the stream becomes errored and the promise rejects', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    write(chunk, done) {
      throw thrownError;
      done();
    }
  });

  var writePromise = ws.write('a');
  t.strictEqual(ws.state, 'errored', 'state is errored after the sink throws');

  var closedPromise = ws.close();

  writePromise.then(
    () => t.fail('the write promise is fulfilled unexpectedly'),
    r => t.strictEqual(r, thrownError, 'the write promise should be rejected with the thrown error')
  );

  ws.close().then(
    () => t.fail('close() is fulfilled unexpectedly'),
    r => t.strictEqual(r, thrownError, 'close() should be rejected with the thrown error')
  );
});
