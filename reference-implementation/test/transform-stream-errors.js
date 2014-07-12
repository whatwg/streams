var test = require('tape');

import TransformStream from '../lib/transform-stream';

test('TransformStream errors thrown in transform put the input and output in an errored state', t => {
  t.plan(8);

  var thrownError = new Error('bad things are happening!');
  var ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  t.equal(ts.output.state, 'waiting', 'output starts in waiting');
  ts.input.write('a');
  t.equal(ts.output.state, 'errored', 'output becomes errored after writing to the throwing transform');

  t.throws(() => ts.output.read(), thrownError, 'output\'s read should throw the thrown error');

  ts.output.wait().then(
    () => t.fail('output\'s wait() should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s wait() should be rejected with the thrown error')
  );

  ts.output.closed.then(
    () => t.fail('output\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'output\'s closed should be rejected with the thrown error')
  );

  ts.input.write('b').then(
    () => t.fail('input\'s write() should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'input\'s write() should be rejected with the thrown error')
  );

  ts.input.wait().then(
    () => t.fail('input\'s wait() should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'input\'s wait() should be rejected with the thrown error')
  );

  ts.input.closed.then(
    () => t.fail('input\'s closed should not be fulfilled'),
    e => t.strictEqual(e, thrownError, 'input\'s closed should be rejected with the thrown error')
  );
});
