const test = require('tape-catch');

// Many other pipeTo-with-options tests have been templated.

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
