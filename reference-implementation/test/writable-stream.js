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

test('WritableStream queue lots of data and have all of them processed at once synchronously', t => {
  var numberOfWrites = 10000;

  var doneForFirstWrite;
  var writeCount = 0;
  var ws = new WritableStream({
    write(chunk, done_) {
      ++writeCount;
      if (!doneForFirstWrite)
        doneForFirstWrite = done_;
      else
        done_();
    }
  });

  for (var i = 0; i < numberOfWrites; ++i) {
    ws.write('a');
  }

  t.strictEqual(ws.state, 'waiting', 'state is waiting since the queue is full of writeRecords');
  t.strictEqual(writeCount, 1);

  doneForFirstWrite();

  t.strictEqual(ws.state, 'writable', 'state is writable again since all writeRecords is done now');
  t.strictEqual(writeCount, numberOfWrites);

  t.end();
});
