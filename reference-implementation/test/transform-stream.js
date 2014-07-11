var test = require('tape');

import TransformStream from '../lib/transform-stream';
import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';

test('TransformStream can be constructed with a transform function', t => {
  t.plan(1);
  t.doesNotThrow(() => new TransformStream({ transform() { } }), 'TransformStream constructed with no errors');
});

test('TransformStream cannot be constructed with no transform function', t => {
  t.plan(2);
  t.throws(() => new TransformStream(), TypeError, 'TransformStream cannot be constructed with no arguments');
  t.throws(() => new TransformStream({ }), TypeError, 'TransformStream cannot be constructed with an empty object');
});

test('TransformStream instances must have input and output properties of the correct types', t => {
  t.plan(4);
  var ts = new TransformStream({ transform() { } });

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'input'), 'it has an input property');
  t.ok(ts.input instanceof WritableStream, 'input is an instance of WritableStream');

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'output'), 'it has an output property');
  t.ok(ts.output instanceof ReadableStream, 'output is an instance of ReadableStream');
});

test('TransformStream inputs and outputs start in the expected states', t => {
  t.plan(2);
  var ts = new TransformStream({ transform() { } });

  t.equal(ts.input.state, 'writable', 'input starts writable');
  t.equal(ts.output.state, 'waiting', 'output starts waiting');
});

test('Pass-through sync TransformStream: can read from output what is put into input', t => {
  t.plan(4);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  ts.input.write('a');

  t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
  t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
  t.equal(ts.output.read(), 'a', 'result from reading the output is the same as was written to input');
  t.equal(ts.output.state, 'waiting', 'output is waiting again after having read all that was written');
});

test('Uppercaser sync TransformStream: can read from output transformed version of what is put into input', t => {
  t.plan(4);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  ts.input.write('a');

  t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
  t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
  t.equal(ts.output.read(), 'A', 'result from reading the output is the transformation of what was written to input');
  t.equal(ts.output.state, 'waiting', 'output is waiting again after having read all that was written');
});

test('Uppercaser-doubler sync TransformStream: can read both chunks put into the output', t => {
  t.plan(6);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  ts.input.write('a');

  t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
  t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
  t.equal(ts.output.read(), 'A', 'the first chunk read is the transformation of the single chunk written');
  t.equal(ts.output.state, 'readable', 'output is readable still after reading the first chunk');
  t.equal(ts.output.read(), 'A', 'the second chunk read is also the transformation of the single chunk written');
  t.equal(ts.output.state, 'waiting', 'output is waiting again after having read both enqueued chunks');
});

test('Uppercaser async TransformStream: output chunk becomes available asynchronously', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(done, 20);
    }
  });

  ts.input.write('a');

  t.equal(ts.input.state, 'waiting', 'input is now waiting since the transform has not signaled done');
  t.equal(ts.output.state, 'waiting', 'output is still not readable');

  ts.output.wait().then(() => {
    t.equal(ts.output.state, 'readable', 'output eventually becomes readable');
    t.equal(ts.output.read(), 'A', 'chunk read from output is the transformation result');
    t.equal(ts.output.state, 'waiting', 'output is waiting again after having read the chunk');

    t.equal(ts.input.state, 'waiting', 'input is still waiting since the transform still has not signaled done');

    return ts.input.wait().then(() => {
      t.equal(ts.input.state, 'writable', 'input eventually becomes writable (after the transform signals done)');
    });
  })
  .catch(t.error);
});

test('Uppercaser-doubler async TransformStream: output chunks becomes available asynchronously', t => {
  t.plan(11);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => enqueue(chunk.toUpperCase()), 20);
      setTimeout(done, 30);
    }
  });

  ts.input.write('a');

  t.equal(ts.input.state, 'waiting', 'input is now waiting since the transform has not signaled done');
  t.equal(ts.output.state, 'waiting', 'output is still not readable');

  ts.output.wait().then(() => {
    t.equal(ts.output.state, 'readable', 'output eventually becomes readable');
    t.equal(ts.output.read(), 'A', 'chunk read from output is the transformation result');
    t.equal(ts.output.state, 'waiting', 'output is waiting again after having read the chunk');

    t.equal(ts.input.state, 'waiting', 'input is still waiting since the transform still has not signaled done');

    return ts.output.wait().then(() => {
      t.equal(ts.output.state, 'readable', 'output becomes readable again');
      t.equal(ts.output.read(), 'A', 'chunk read from output is the transformation result');
      t.equal(ts.output.state, 'waiting', 'output is waiting again after having read the chunk');

      t.equal(ts.input.state, 'waiting', 'input is still waiting since the transform still has not signaled done');

      return ts.input.wait().then(() => {
        t.equal(ts.input.state, 'writable', 'input eventually becomes writable (after the transform signals done)');
      });
    });
  })
  .catch(t.error);
});
