const test = require('tape-catch');

import readableStreamToArray from './utils/readable-stream-to-array';

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
  const ts = new TransformStream({ transform() { } });

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'writable'), 'it has a writable property');
  t.ok(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');

  t.ok(Object.prototype.hasOwnProperty.call(ts, 'readable'), 'it has a readable property');
  t.ok(ts.readable instanceof ReadableStream, 'readable is an instance of ReadableStream');
});

test('TransformStream writable starts in the writable state', t => {
  t.plan(1);
  const ts = new TransformStream({ transform() { } });

  t.equal(ts.writable.state, 'writable', 'writable starts writable');
});

test('Pass-through sync TransformStream: can read from readable what is put into writable', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  ts.writable.write('a');

  t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');
  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      'result from reading the readable is the same as was written to writable');

    return ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser sync TransformStream: can read from readable transformed version of what is put into writable', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  ts.writable.write('a');

  t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');

  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'A', done: false },
      'result from reading the readable is the transformation of what was written to writable');

    return ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser-doubler sync TransformStream: can read both chunks put into the readable', t => {
  t.plan(4);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk.toUpperCase());
      enqueue(chunk.toUpperCase());
      done();
    }
  });

  ts.writable.write('a');

  t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');

  const reader = ts.readable.getReader();

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'A', done: false },
      'the first chunk read is the transformation of the single chunk written');

    return reader.read().then(result2 => {
    t.deepEqual(result2, { value: 'A', done: false },
      'the second chunk read is also the transformation of the single chunk written');

      return ts.writable.ready.then(() => {
        t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
      });
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser async TransformStream: can read from readable transformed version of what is put into writable', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(done, 50);
    }
  });

  ts.writable.write('a');

  t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');

  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'A', done: false },
      'result from reading the readable is the transformation of what was written to writable');

    return ts.writable.ready.then(() => {
      t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser-doubler async TransformStream: can read both chunks put into the readable', t => {
  t.plan(4);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => enqueue(chunk.toUpperCase()), 50);
      setTimeout(done, 90);
    }
  });

  const reader = ts.readable.getReader();

  ts.writable.write('a');

  t.equal(ts.writable.state, 'waiting', 'writable is waiting after one write');
  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'A', done: false },
      'the first chunk read is the transformation of the single chunk written');

    return reader.read().then(result2 => {
    t.deepEqual(result2, { value: 'A', done: false },
      'the second chunk read is also the transformation of the single chunk written');

      return ts.writable.ready.then(() => {
        t.equal(ts.writable.state, 'writable', 'writable becomes writable again');
      });
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable closes the readable (when there are no queued writes)', t => {
  t.plan(3);

  const ts = new TransformStream({ transform() { } });

  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');

  Promise.all([ts.writable.closed, ts.readable.closed]).then(() => {
    t.pass('both writable and readable closed promises fulfill');
    t.equal(ts.writable.state, 'closed', 'writable state becomes closed eventually');
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable waits for transforms to finish before closing both', t => {
  t.plan(4);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(done, 50);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');

  let rsClosed = false;
  ts.readable.closed.then(() => {
    rsClosed = true;
  });

  setTimeout(() => {
    t.equal(rsClosed, false, 'readable is not closed after a tick');

    ts.writable.closed.then(() => {
      t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');
      t.equal(rsClosed, true, 'readable is closed at that point');
    })
    .catch(e => t.error(e));
  }, 0);
});

test('TransformStream: by default, closing the writable closes the readable after sync enqueues and async done', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue('x');
      enqueue('y');
      setTimeout(done, 50);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');

  ts.writable.closed.then(() => {
    t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');

    return readableStreamToArray(ts.readable).then(chunks => {
      t.deepEqual(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable closes the readable after async enqueues and async done', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(() => enqueue('x'), 10);
      setTimeout(() => enqueue('y'), 50);
      setTimeout(done, 90);
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.equal(ts.writable.state, 'closing', 'writable is closing');

  ts.writable.closed.then(() => {
    t.equal(ts.writable.state, 'closed', 'writable becomes closed eventually');

    return readableStreamToArray(ts.readable).then(chunks => {
      t.deepEqual(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream flush is called immediately when the writable is closed, if no writes are queued', t => {
  t.plan(1);

  let flushCalled = false;
  const ts = new TransformStream({
    transform() { },
    flush(enqueue) {
      flushCalled = true;
    }
  });

  ts.writable.close().then(() => {
    t.ok(flushCalled, 'closing the writable triggers the transform flush immediately');
  });
});

test('TransformStream flush is called after all queued writes finish, once the writable is closed', t => {
  t.plan(3);

  let flushCalled = false;
  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      setTimeout(done, 10);
    },
    flush(enqueue) {
      flushCalled = true;
    }
  });

  ts.writable.write('a');
  ts.writable.close();
  t.notOk(flushCalled, 'closing the writable does not immediately call flush if writes are not finished');

  let rsClosed = false;
  ts.readable.closed.then(() => {
    rsClosed = true;
  });

  setTimeout(() => {
    t.ok(flushCalled, 'flush is eventually called');
    t.equal(rsClosed, false, 'if flush does not call close, the readable does not become closed');
  }, 50);
});

test('TransformStream flush gets a chance to enqueue more into the readable', t => {
  t.plan(2);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush(enqueue) {
      enqueue('x');
      enqueue('y');
    }
  });

  const reader = ts.readable.getReader();

  ts.writable.write('a');
  ts.writable.close();
  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'x', done: false }, 'the first chunk read is the first one enqueued in flush');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'y', done: false }, 'the second chunk read is the second one enqueued in flush');
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream flush gets a chance to enqueue more into the readable, and can then async close', t => {
  t.plan(3);

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      done();
    },
    flush(enqueue, close) {
      enqueue('x');
      enqueue('y');
      setTimeout(close, 10);
    }
  });

  const reader = ts.readable.getReader();

  ts.writable.write('a');
  ts.writable.close();
  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'x', done: false }, 'the first chunk read is the first one enqueued in flush');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'y', done: false }, 'the second chunk read is the second one enqueued in flush');
    });
  })
  .catch(e => t.error(e));

  ts.readable.closed.then(() => {
    t.pass('readable becomes closed');
  })
  .catch(e => t.error(e));
});
