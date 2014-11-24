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
  t.throws(() => new TransformStream(), /TypeError/, 'TransformStream cannot be constructed with no arguments');
  t.throws(() => new TransformStream({ }), /TypeError/, 'TransformStream cannot be constructed with an empty object');
});

test('TransformStream instances must have writable and readable properties of the correct types', t => {
  t.plan(4);
  var ts = new TransformStream({ transform() { } });

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'writable'), 'it has a writable property');
  t.ok(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'readable'), 'it has a readable property');
  t.ok(ts.readable instanceof ReadableStream, 'readable is an instance of ReadableStream');
});

test('TransformStream writables and readables start in the expected states', t => {
  t.plan(2);
  var ts = new TransformStream({ transform() { } });

  t.equal(ts.writable.state, 'writable', 'writable starts writable');
  t.equal(ts.readable.state, 'waiting', 'readable starts waiting');
});

test('Pass-through sync TransformStream: can read from readable what is put into writable', t => {
  t.plan(5);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  setTimeout(() => {
    ts.writable.write('a');

    t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');
    t.equal(ts.readable.state, 'readable', 'readable is readable since transformation is sync');
    t.equal(ts.readable.read(), 'a', 'result from reading the readable is the same as was written to writable');
    t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read all that was written');
    ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    })
    .catch(t.error);
  }, 0);
});

test('Uppercaser sync TransformStream: can read from readable transformed version of what is put into writable', t => {
  t.plan(5);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  setTimeout(() => {
    ts.writable.write('a');

    t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');
    t.equal(ts.readable.state, 'readable', 'readable is readable since transformation is sync');
    t.equal(ts.readable.read(), 'A', 'result from reading the readable is the same as was written to writable');
    t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read all that was written');
    ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    })
    .catch(t.error);
  }, 0);
});

test('Uppercaser-doubler sync TransformStream: can read both chunks put into the readable', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  setTimeout(() => {
    ts.writable.write('a');

    t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');
    t.equal(ts.readable.state, 'readable', 'readable is readable after writing to writable');
    t.equal(ts.readable.read(), 'A', 'the first chunk read is the transformation of the single chunk written');
    t.equal(ts.readable.state, 'readable', 'readable is readable still after reading the first chunk');
    t.equal(ts.readable.read(), 'A', 'the second chunk read is also the transformation of the single chunk written');
    t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read both enqueued chunks');
    ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    })
    .catch(t.error);
  }, 0);
});

test('Uppercaser async TransformStream: readable chunk becomes available asynchronously', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(done, 50);
    }
  });

  setTimeout(() => {
    ts.writable.write('a');

    t.equal(ts.writable.state, 'waiting', 'writable is now waiting since the transform has not signaled done');
    t.equal(ts.readable.state, 'waiting', 'readable is still not readable');

    ts.readable.ready.then(() => {
      t.equal(ts.readable.state, 'readable', 'readable eventually becomes readable');
      t.equal(ts.readable.read(), 'A', 'chunk read from readable is the transformation result');
      t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read the chunk');

      t.equal(ts.writable.state, 'waiting', 'writable is still waiting since the transform still has not signaled done');

      return ts.writable.ready.then(() => {
        t.equal(ts.writable.state, 'writable', 'writable eventually becomes writable (after the transform signals done)');
      });
    })
    .catch(t.error);
  }, 0);
});

test('Uppercaser-doubler async TransformStream: readable chunks becomes available asynchronously', t => {
  t.plan(11);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => enqueue(chunk.toUpperCase()), 50);
      setTimeout(done, 90);
    }
  });

  setTimeout(() => {
    ts.writable.write('a');

    t.equal(ts.writable.state, 'waiting', 'writable is now waiting since the transform has not signaled done');
    t.equal(ts.readable.state, 'waiting', 'readable is still not readable');

    ts.readable.ready.then(() => {
      t.equal(ts.readable.state, 'readable', 'readable eventually becomes readable');
      t.equal(ts.readable.read(), 'A', 'chunk read from readable is the transformation result');
      t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read the chunk');

      t.equal(ts.writable.state, 'waiting', 'writable is still waiting since the transform still has not signaled done');

      return ts.readable.ready.then(() => {
        t.equal(ts.readable.state, 'readable', 'readable becomes readable again');
        t.equal(ts.readable.read(), 'A', 'chunk read from readable is the transformation result');
        t.equal(ts.readable.state, 'waiting', 'readable is waiting again after having read the chunk');

        t.equal(ts.writable.state, 'waiting', 'writable is still waiting since the transform still has not signaled done');

        return ts.writable.ready.then(() => {
          t.equal(ts.writable.state, 'writable', 'writable eventually becomes writable (after the transform signals done)');
        });
      });
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the writable closes the readable (when there are no queued writes)', t => {
  t.plan(4);

  var ts = new TransformStream({ transform() { } });

  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');
  setTimeout(() => {
    t.equal(ts.readable.state, 'closed', 'readable is closed within a tick');

    ts.writable.closed.then(() => {
      t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');
      t.equal(ts.readable.state, 'closed', 'readable is still closed at that time');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the writable waits for transforms to finish before closing both', t => {
  t.plan(4);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(done, 50);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');
  setTimeout(() => {
    t.equal(ts.readable.state, 'waiting', 'readable is still waiting after a tick');

    ts.writable.closed.then(() => {
      t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');
      t.equal(ts.readable.state, 'closed', 'readable is closed at that point');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the writable closes the readable after sync enqueues and async done', t => {
  t.plan(7);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue('x');
      enqueue('y');
      setTimeout(done, 50);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');
  setTimeout(() => {
    t.equal(ts.readable.state, 'readable', 'readable is readable');

    ts.writable.closed.then(() => {
      t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');
      t.equal(ts.readable.state, 'readable', 'readable is still readable at that time');

      t.equal(ts.readable.read(), 'x', 'can read the first enqueued chunk from the readable');
      t.equal(ts.readable.read(), 'y', 'can read the second enqueued chunk from the readable');

      t.equal(ts.readable.state, 'closed', 'after reading, the readable is now closed');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream: by default, closing the writable closes the readable after async enqueues and async done', t => {
  t.plan(8);

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue('x'), 10);
      setTimeout(() => enqueue('y'), 50);
      setTimeout(done, 90);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');
  setTimeout(() => {
    t.equal(ts.readable.state, 'waiting', 'readable starts waiting');

    ts.writable.closed.then(() => {
      t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');
      t.equal(ts.readable.state, 'readable', 'readable is now readable since all chunks have been enqueued');
      t.equal(ts.readable.read(), 'x', 'can read the first enqueued chunk from the readable');
      t.equal(ts.readable.state, 'readable', 'after reading one chunk, the readable is still readable');
      t.equal(ts.readable.read(), 'y', 'can read the second enqueued chunk from the readable');
      t.equal(ts.readable.state, 'closed', 'after reading two chunks, the readable is now closed');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream flush is called immediately when the writable is closed, if no writes are queued', t => {
  t.plan(1);

  var flushCalled = false;
  var ts = new TransformStream({
    transform() { },
    flush(enqueue) {
      flushCalled = true;
    }
  });

  setTimeout(() => {
    ts.writable.close();
    t.ok(flushCalled, 'closing the writable triggers the transform flush immediately');
  }, 0);
});

test('TransformStream flush is called after all queued writes finish, once the writable is closed', t => {
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
    ts.writable.write('a');
    ts.writable.close();
    t.notOk(flushCalled, 'closing the writable does not immediately call flush if writes are not finished');

    setTimeout(() => {
      t.ok(flushCalled, 'flush is eventually called');
      t.equal(ts.readable.state, 'waiting', 'if flush does not call close, the readable stays open');
    }, 50);
  }, 0);
});

test('TransformStream flush gets a chance to enqueue more into the readable', t => {
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
    t.equal(ts.readable.state, 'waiting', 'before doing anything, the readable is waiting');
    ts.writable.write('a');
    t.equal(ts.readable.state, 'waiting', 'after a write to the writable, the readable is still waiting');
    ts.writable.close();
    ts.readable.ready.then(() => {
      t.equal(ts.readable.state, 'readable', 'after closing the writable, the readable is now readable as a result of flush');
      t.equal(ts.readable.read(), 'x', 'reading the first chunk gives back what was enqueued');
      t.equal(ts.readable.read(), 'y', 'reading the second chunk gives back what was enqueued');
      t.equal(ts.readable.state, 'waiting', 'after reading both chunks, the readable is waiting, since close was not called');
    })
    .catch(t.error);
  }, 0);
});

test('TransformStream flush gets a chance to enqueue more into the readable, and can then async close', t => {
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
    t.equal(ts.readable.state, 'waiting', 'before doing anything, the readable is waiting');
    ts.writable.write('a');
    t.equal(ts.readable.state, 'waiting', 'after a write to the writable, the readable is still waiting');
    ts.writable.close();
    ts.readable.ready.then(() => {
      t.equal(ts.readable.state, 'readable', 'after closing the writable, the readable is now readable as a result of flush');
      t.equal(ts.readable.read(), 'x', 'reading the first chunk gives back what was enqueued');
      t.equal(ts.readable.read(), 'y', 'reading the second chunk gives back what was enqueued');
      t.equal(ts.readable.state, 'waiting', 'after reading both chunks, the readable is waiting, since close was not called');
    })
    .catch(t.error);

    ts.readable.closed.then(() => {
      t.equal(ts.readable.state, 'closed', 'the readable eventually does close, after close is called from flush');
    })
    .catch(t.error);
  }, 0);
});
