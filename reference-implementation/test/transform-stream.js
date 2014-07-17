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

  setTimeout(() => {
    t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
    t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
    t.equal(ts.output.read(), 'a', 'result from reading the output is the same as was written to input');
    t.equal(ts.output.state, 'waiting', 'output is waiting again after having read all that was written');
  }, 0);
});

test('Uppercaser sync TransformStream: can read from output transformed version of what is put into input', t => {
  t.plan(4);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  setTimeout(() => {
    ts.input.write('a');

    t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
    t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
    t.equal(ts.output.read(), 'A', 'result from reading the output is the transformation of what was written to input');
    t.equal(ts.output.state, 'waiting', 'output is waiting again after having read all that was written');
  }, 0);
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

  setTimeout(() => {
    ts.input.write('a');

    t.equal(ts.input.state, 'writable', 'input is still writable since the transform was sync');
    t.equal(ts.output.state, 'readable', 'output is readable after writing to input');
    t.equal(ts.output.read(), 'A', 'the first chunk read is the transformation of the single chunk written');
    t.equal(ts.output.state, 'readable', 'output is readable still after reading the first chunk');
    t.equal(ts.output.read(), 'A', 'the second chunk read is also the transformation of the single chunk written');
    t.equal(ts.output.state, 'waiting', 'output is waiting again after having read both enqueued chunks');
  }, 0);
});

test('Uppercaser async TransformStream: output chunk becomes available asynchronously', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(done, 50);
    }
  });

  setTimeout(() => {
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
  }, 0);
});

test('Uppercaser-doubler async TransformStream: output chunks becomes available asynchronously', t => {
  t.plan(11);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => enqueue(chunk.toUpperCase()), 50);
      setTimeout(done, 90);
    }
  });

  setTimeout(() => {
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
  }, 0);
});

test('TransformStream: by default, closing the input closes the output (when there are no queued writes)', t => {
  t.plan(4);

  var ts = new TransformStream({ transform() { } });

  ts.input.close();
  t.equal(ts.input.state, 'closing', 'input is closing');
  setTimeout(() => {
    t.equal(ts.output.state, 'closed', 'output is closed within a tick');

    ts.input.closed.then(() => {
      t.equal(ts.input.state, 'closed', 'input becomes closed eventually');
      t.equal(ts.output.state, 'closed', 'output is still closed at that time');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the input waits for transforms to finish before closing both', t => {
  t.plan(4);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(done, 50);
    }
  });

  ts.input.write('a');
  ts.input.close();
  t.equal(ts.input.state, 'closing', 'input is closing');
  setTimeout(() => {
    t.equal(ts.output.state, 'waiting', 'output is still waiting after a tick');

    ts.input.closed.then(() => {
      t.equal(ts.input.state, 'closed', 'input becomes closed eventually');
      t.equal(ts.output.state, 'closed', 'output is closed at that point');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the input closes the output after sync enqueues and async done', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue('x');
      enqueue('y');
      setTimeout(done, 50);
    }
  });

  ts.input.write('a');
  ts.input.close();
  t.equal(ts.input.state, 'closing', 'input is closing');
  setTimeout(() => {
    t.equal(ts.output.state, 'readable', 'output is readable');

    ts.input.closed.then(() => {
      t.equal(ts.input.state, 'closed', 'input becomes closed eventually');
      t.equal(ts.output.state, 'readable', 'output is still readable at that time');

      t.equal(ts.output.read(), 'x', 'can read the first enqueued chunk from the output');
      t.equal(ts.output.read(), 'y', 'can read the second enqueued chunk from the output');

      t.equal(ts.output.state, 'closed', 'after reading, the output is now closed');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the input closes the output after async enqueues and async done', t => {
  t.plan(8);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue('x'), 10);
      setTimeout(() => enqueue('y'), 50);
      setTimeout(done, 90);
    }
  });

  ts.input.write('a');
  ts.input.close();
  t.equal(ts.input.state, 'closing', 'input is closing');
  setTimeout(() => {
    t.equal(ts.output.state, 'waiting', 'output starts waiting');

    ts.input.closed.then(() => {
      t.equal(ts.input.state, 'closed', 'input becomes closed eventually');
      t.equal(ts.output.state, 'readable', 'output is now readable since all chunks have been enqueued');
      t.equal(ts.output.read(), 'x', 'can read the first enqueued chunk from the output');
      t.equal(ts.output.state, 'readable', 'after reading one chunk, the output is still readable');
      t.equal(ts.output.read(), 'y', 'can read the second enqueued chunk from the output');
      t.equal(ts.output.state, 'closed', 'after reading two chunks, the output is now closed');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream flush is called immediately when the input is closed, if no writes are queued', t => {
  t.plan(1);

  var flushCalled = false;
  var ts = new TransformStream({
    transform() { },
    flush(enqueue) {
      flushCalled = true;
    }
  });

  setTimeout(() => {
    ts.input.close();
    t.ok(flushCalled, 'closing the input triggers the transform flush immediately');
  }, 0);
});

test('TransformStream flush is called after all queued writes finish, once the input is closed', t => {
  t.plan(3);

  var flushCalled = false;
  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(done, 10);
    },
    flush(enqueue) {
      flushCalled = true;
    }
  });

  setTimeout(() => {
    ts.input.write('a');
    ts.input.close();
    t.notOk(flushCalled, 'closing the input does not immediately call flush if writes are not finished');

    setTimeout(() => {
      t.ok(flushCalled, 'flush is eventually called');
      t.equal(ts.output.state, 'waiting', 'if flush does not call close, the output stays open');
    }, 50);
  }, 0);
});

test('TransformStream flush gets a chance to enqueue more into the output', t => {
  t.plan(6);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush(enqueue) {
      enqueue('x');
      enqueue('y');
    }
  });

  setTimeout(() => {
    t.equal(ts.output.state, 'waiting', 'before doing anything, the output is waiting');
    ts.input.write('a');
    t.equal(ts.output.state, 'waiting', 'after a write to the input, the output is still waiting');
    ts.input.close();
    t.equal(ts.output.state, 'readable', 'after closing the input, the output is now readable as a result of flush');
    t.equal(ts.output.read(), 'x', 'reading the first chunk gives back what was enqueued');
    t.equal(ts.output.read(), 'y', 'reading the second chunk gives back what was enqueued');
    t.equal(ts.output.state, 'waiting', 'after reading both chunks, the output is waiting, since close was not called');
  }, 0);
});

test('TransformStream flush gets a chance to enqueue more into the output, and can then async close', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush(enqueue, close) {
      enqueue('x');
      enqueue('y');
      setTimeout(close, 10);
    }
  });

  setTimeout(() => {
    t.equal(ts.output.state, 'waiting', 'before doing anything, the output is waiting');
    ts.input.write('a');
    t.equal(ts.output.state, 'waiting', 'after a write to the input, the output is still waiting');
    ts.input.close();
    t.equal(ts.output.state, 'readable', 'after closing the input, the output is now readable as a result of flush');
    t.equal(ts.output.read(), 'x', 'reading the first chunk gives back what was enqueued');
    t.equal(ts.output.read(), 'y', 'reading the second chunk gives back what was enqueued');
    t.equal(ts.output.state, 'waiting', 'after reading both chunks, the output is waiting, since close was not called');

    ts.output.closed.then(() => {
      t.equal(ts.output.state, 'closed', 'the output eventually does close, after close is called from flush');
    })
    .catch(t.error);
  }, 0);
});
