const test = require('tape-catch');

test('TransformStream errors thrown in transform put the writable and readable in an errored state', t => {
  t.plan(5);

  const thrownError = new Error('bad things are happening!');
  const ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  t.equal(ts.writable.state, 'writable', 'writable starts in writable');

  ts.readable.getReader().read().then(
    () => t.fail('readable\'s read() should reject'),
    r => t.equal(r, thrownError, 'readable\'s read should reject with the thrown error')
  );

  ts.readable.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  ts.writable.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );

  ts.writable.write('a');
  t.equal(ts.writable.state, 'waiting', 'writable becomes waiting immediately after throw');
});

test('TransformStream errors thrown in flush put the writable and readable in an errored state', t => {
  t.plan(6);

  const thrownError = new Error('bad things are happening!');
  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush() {
      throw thrownError;
    }
  });

  ts.readable.getReader().read().then(
    () => t.fail('readable\'s read() should reject'),
    r => t.equal(r, thrownError, 'readable\'s read should reject with the thrown error')
  );

  ts.readable.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  ts.writable.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );

  t.equal(ts.writable.state, 'writable', 'writable starts in writable');
  ts.writable.write('a');
  t.equal(ts.writable.state, 'waiting', 'writable becomes waiting after a write');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable becomes closing after the close call');
});
