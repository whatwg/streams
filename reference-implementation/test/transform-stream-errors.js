var test = require('tape');

import TransformStream from '../lib/transform-stream';

test('TransformStream errors thrown in transform put the input and output in an errored state', t => {
  t.plan(10);

  var thrownError = new Error('bad things are happening!');
  var ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  t.equal(ts.output.state, 'waiting', 'output starts in waiting');
  t.equal(ts.input.state, 'writable', 'input starts in writable');

  ts.input.write('a');

  t.equal(ts.output.state, 'waiting', 'output stays in waiting immediately after throw');
  t.equal(ts.input.state, 'waiting', 'input stays in waiting immediately after throw');

  setTimeout(() => {
    t.equal(ts.output.state, 'errored', 'output becomes errored after writing to the throwing transform');
    t.equal(ts.input.state, 'errored', 'input becomes errored after writing to the throwing transform');

    try {
      ts.output.read();
      t.fail('read() didn\'nt throw');
    } catch (error) {
      t.strictEqual(error, thrownError, 'output\'s read should throw the thrown error');
    }
  }, 0);

  ts.output.wait().then(
    () => t.fail('output\'s wait() should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s wait() should be rejected with the thrown error')
  );

  ts.output.closed.then(
    () => t.fail('output\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s closed should be rejected with the thrown error')
  );

  ts.input.closed.then(
    () => t.fail('input\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'input\'s closed should be rejected with the thrown error')
  );
});

test('TransformStream errors thrown in flush put the input and output in an errored state', t => {
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

  t.equal(ts.output.state, 'waiting', 'output starts in waiting');
  t.equal(ts.input.state, 'writable', 'input starts in writable');

  ts.input.write('a');

  t.equal(ts.output.state, 'waiting', 'output stays in waiting after a write');
  t.equal(ts.input.state, 'waiting', 'input stays in waiting after a write');

  ts.input.close();

  t.equal(ts.output.state, 'waiting', 'output stays in waiting immediately after a throw');
  t.equal(ts.input.state, 'closing', 'input becomes closing immediately after a throw');

  setTimeout(() => {
    t.equal(ts.output.state, 'errored', 'output becomes errored after closing with the throwing flush');
    t.equal(ts.input.state, 'errored', 'input becomes errored after closing with the throwing flush');

    try {
      ts.output.read();
      t.fail('read() didn\'nt throw');
    } catch (error) {
      t.strictEqual(error, thrownError, 'output\'s read should throw the thrown error');
    }
  }, 0);

  ts.output.wait().then(
    () => t.fail('output\'s wait() should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s wait() should be rejected with the thrown error')
  );

  ts.output.closed.then(
    () => t.fail('output\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s closed should be rejected with the thrown error')
  );

  ts.input.closed.then(
    () => t.fail('input\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'input\'s closed should be rejected with the thrown error')
  );
});
