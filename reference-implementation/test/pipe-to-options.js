const test = require('tape-catch');

import sequentialReadableStream from './utils/sequential-rs';

test('Piping with no options and no errors', t => {
  const rs = sequentialReadableStream(5, { async: true });
  const ws = new WritableStream({
    abort() {
      t.fail('unexpected abort call');
    }
  });

  rs.pipeTo(ws).then(() => {
    t.equal(ws.state, 'closed', 'destination should be closed');
    t.end();
  });
});

test('Piping with { preventClose: false } and no errors', t => {
  const rs = sequentialReadableStream(5, { async: true });
  const ws = new WritableStream({
    abort() {
      t.fail('unexpected abort call');
    }
  });

  rs.pipeTo(ws, { preventClose: false }).then(() => {
    t.equal(ws.state, 'closed', 'destination should be closed');
    t.end();
  });
});

test('Piping with { preventClose: true } and no errors', t => {
  const rs = sequentialReadableStream(5, { async: true });
  const ws = new WritableStream({
    close() {
      t.fail('unexpected close call');
      t.end();
    },
    abort() {
      t.fail('unexpected abort call');
    }
  });

  rs.pipeTo(ws, { preventClose: true }).then(() => {
    t.equal(ws.state, 'writable', 'destination should be writable');
    t.end();
  });
});

test('Piping with no options and a source error', t => {
  const theError = new Error('source error');
  const rs = new ReadableStream({
    start() {
      return Promise.reject(theError);
    }
  });
  const ws = new WritableStream({
    abort(r) {
      t.equal(r, theError, 'reason passed to abort equals the source error');
      t.end();
    }
  });

  rs.pipeTo(ws);
});

test('Piping with { preventAbort: false } and a source error', t => {
  const theError = new Error('source error');
  const rs = new ReadableStream({
    start() {
      return Promise.reject(theError);
    }
  });
  const ws = new WritableStream({
    abort(r) {
      t.equal(r, theError, 'reason passed to abort equals the source error');
      t.end();
    }
  });

  rs.pipeTo(ws, { preventAbort: false });
});

test('Piping with { preventAbort: true } and a source error', t => {
  const theError = new Error('source error');
  const rs = new ReadableStream({
    start() {
      return Promise.reject(theError);
    }
  });
  const ws = new WritableStream({
    abort(r) {
      t.fail('unexpected call to abort');
      t.end();
    }
  });

  rs.pipeTo(ws, { preventAbort: true }).catch(e => {
    t.equal(ws.state, 'writable', 'destination should remain writable');
    t.equal(e, theError, 'rejection reason of pipeToPromise is the source error');
    t.end();
  });
});

test('Piping with no options and a destination error', t => {
  t.plan(2);

  const theError = new Error('destination error');
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      setTimeout(() => enqueue('b'), 10);
      setTimeout(() => {
        t.throws(() => enqueue('c'), /TypeError/, 'enqueue after cancel must throw a TypeError');
      }, 20);
    },
    cancel(r) {
      t.equal(r, theError, 'reason passed to cancel equals the source error');
    }
  });

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws);
});

test('Piping with { preventCancel: false } and a destination error', t => {
  t.plan(2);

  const theError = new Error('destination error');
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      setTimeout(() => enqueue('b'), 10);
      setTimeout(() => {
        t.throws(() => enqueue('c'), /TypeError/, 'enqueue after cancel must throw a TypeError');
      }, 20);
    },
    cancel(r) {
      t.equal(r, theError, 'reason passed to cancel equals the source error');
    }
  });

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws, { preventCancel: false });
});

test('Piping with { preventCancel: true } and a destination error', t => {
  const theError = new Error('destination error');
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      setTimeout(() => enqueue('b'), 10);
      setTimeout(() => enqueue('c'), 20);
      setTimeout(() => enqueue('d'), 30);
    },
    cancel(r) {
      t.fail('unexpected call to cancel');
      t.end();
    }
  });

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws, { preventCancel: true }).catch(e => {
    t.equal(e, theError, 'rejection reason of pipeTo promise is the sink error');

    let reader;
    t.doesNotThrow(() => { reader = rs.getReader(); }, 'should be able to get a stream reader after pipeTo completes');

    // { value: 'c', done: false } gets consumed before we know that ws has errored, and so is lost.

    return reader.read().then(result => {
      t.deepEqual(result, { value: 'd', done: false }, 'should be able to read the remaining chunk from the reader');
      t.end();
    });
  })
  .catch(e => t.error(e));
});
