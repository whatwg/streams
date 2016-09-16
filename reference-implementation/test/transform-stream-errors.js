'use strict';
const test = require('tape-catch');

test('TransformStream errors thrown in transform put the writable and readable in an errored state', t => {
  t.plan(3);

  const thrownError = new Error('bad things are happening!');
  const ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  const reader = ts.readable.getReader();

  reader.read().then(
    () => t.fail('readable\'s read() should reject'),
    r => t.equal(r, thrownError, 'readable\'s read should reject with the thrown error')
  );

  reader.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  const writer = ts.writable.getWriter();

  writer.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );

  writer.write('a');
});

test('TransformStream errors thrown in flush put the writable and readable in an errored state', t => {
  t.plan(3);

  const thrownError = new Error('bad things are happening!');
  const ts = new TransformStream({
    transform() {
    },
    flush() {
      throw thrownError;
    }
  });

  const reader = ts.readable.getReader();

  reader.read().then(
    () => t.fail('readable\'s read() should reject'),
    r => t.equal(r, thrownError, 'readable\'s read should reject with the thrown error')
  );

  reader.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  const writer = ts.writable.getWriter();

  writer.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );

  writer.write('a');
  writer.close();
});
