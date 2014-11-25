var test = require('tape');

import TransformStream from '../lib/transform-stream';

test('TransformStream errors thrown in transform put the writable and readable in an errored state', t => {
  t.plan(10);

  var thrownError = new Error('bad things are happening!');
  var ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  t.equal(ts.readable.state, 'waiting', 'readable starts in waiting');
  t.equal(ts.writable.state, 'writable', 'writable starts in writable');

  ts.writable.write('a');

  t.equal(ts.readable.state, 'waiting', 'readable stays in waiting immediately after throw');
  t.equal(ts.writable.state, 'waiting', 'writable stays in waiting immediately after throw');

  setTimeout(() => {
    t.equal(ts.readable.state, 'errored', 'readable becomes errored after writing to the throwing transform');
    t.equal(ts.writable.state, 'errored', 'writable becomes errored after writing to the throwing transform');

    try {
      ts.readable.read();
      t.fail('read() didn\'nt throw');
    } catch (error) {
      t.equal(error, thrownError, 'readable\'s read should throw the thrown error');
    }
  }, 0);

  ts.readable.ready.then(
    () => t.fail('readable\'s ready should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s ready should be rejected with the thrown error')
  );

  ts.readable.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  ts.writable.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );
});

test('TransformStream errors thrown in flush put the writable and readable in an errored state', t => {
  t.plan(12);

  var thrownError = new Error('bad things are happening!');
  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush() {
      throw thrownError;
    }
  });

  t.equal(ts.readable.state, 'waiting', 'readable starts in waiting');
  t.equal(ts.writable.state, 'writable', 'writable starts in writable');

  ts.writable.write('a');

  t.equal(ts.readable.state, 'waiting', 'readable stays in waiting after a write');
  t.equal(ts.writable.state, 'waiting', 'writable stays in waiting after a write');

  ts.writable.close();

  t.equal(ts.readable.state, 'waiting', 'readable stays in waiting immediately after a throw');
  t.equal(ts.writable.state, 'closing', 'writable becomes closing immediately after a throw');

  setTimeout(() => {
    t.equal(ts.readable.state, 'errored', 'readable becomes errored after closing with the throwing flush');
    t.equal(ts.writable.state, 'errored', 'writable becomes errored after closing with the throwing flush');

    try {
      ts.readable.read();
      t.fail('read() didn\'nt throw');
    } catch (error) {
      t.equal(error, thrownError, 'readable\'s read should throw the thrown error');
    }
  }, 0);

  ts.readable.ready.then(
    () => t.fail('readable\'s ready should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s ready should be rejected with the thrown error')
  );

  ts.readable.closed.then(
    () => t.fail('readable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'readable\'s closed should be rejected with the thrown error')
  );

  ts.writable.closed.then(
    () => t.fail('writable\'s closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'writable\'s closed should be rejected with the thrown error')
  );
});
