'use strict';
const test = require('tape-catch');

const readableStreamToArray = require('./utils/readable-stream-to-array.js');

test('TransformStream can be constructed with a transform function', t => {
  t.plan(1);
  t.doesNotThrow(() => new TransformStream({ transform() { } }), 'TransformStream constructed with no errors');
});

test('TransformStream cannot be constructed with no transform function', t => {
  t.plan(2);
  t.throws(() => new TransformStream(), /TypeError/, 'TransformStream cannot be constructed with no arguments');
  t.throws(() => new TransformStream({}), /TypeError/, 'TransformStream cannot be constructed with an empty object');
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

  const writer = ts.writable.getWriter();
  t.equal(writer.desiredSize, 1, 'writer.desiredSize should be 1');
});

test('Pass-through sync TransformStream: can read from readable what is put into writable', t => {
  t.plan(3);

  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      c.enqueue(chunk);
      done();
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  t.equal(writer.desiredSize, 0, 'writer.desiredSize should be 0 after write()');

  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      'result from reading the readable is the same as was written to writable');

    return writer.ready.then(() => {
      t.equal(writer.desiredSize, 1, 'desiredSize should be 1 again');
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser sync TransformStream: can read from readable transformed version of what is put into writable', t => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      c.enqueue(chunk.toUpperCase());
      done();
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'A', done: false },
      'result from reading the readable is the transformation of what was written to writable');
    t.end();
  })
  .catch(e => t.error(e));
});

test('Uppercaser-doubler sync TransformStream: can read both chunks put into the readable', t => {
  t.plan(2);

  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      c.enqueue(chunk.toUpperCase());
      c.enqueue(chunk.toUpperCase());
      done();
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  const reader = ts.readable.getReader();

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'A', done: false },
      'the first chunk read is the transformation of the single chunk written');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'A', done: false },
        'the second chunk read is also the transformation of the single chunk written');
    });
  })
  .catch(e => t.error(e));
});

test('Uppercaser async TransformStream: can read from readable transformed version of what is put into writable', t => {
  t.plan(1);

  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      setTimeout(done, 50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  ts.readable.getReader().read().then(result => {
    t.deepEqual(result, { value: 'A', done: false },
      'result from reading the readable is the transformation of what was written to writable');
  })
  .catch(e => t.error(e));
});

test('Uppercaser-doubler async TransformStream: can read both chunks put into the readable', t => {
  t.plan(2);

  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 50);
      setTimeout(done, 90);
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();
  writer.write('a');

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'A', done: false },
      'the first chunk read is the transformation of the single chunk written');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'A', done: false },
        'the second chunk read is also the transformation of the single chunk written');
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable closes the readable (when there are no queued writes)', t => {
  const ts = new TransformStream({ transform() { } });

  const writer = ts.writable.getWriter();
  writer.close();

  Promise.all([writer.closed, ts.readable.getReader().closed]).then(() => {
    t.pass('both writable and readable closed promises fulfill');
    t.end();
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable waits for transforms to finish before closing both', t => {
  t.plan(2);

  const ts = new TransformStream({
    transform(chunk, done) {
      setTimeout(done, 50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  let rsClosed = false;
  ts.readable.getReader().closed.then(() => {
    rsClosed = true;
  });

  setTimeout(() => {
    t.equal(rsClosed, false, 'readable is not closed after a tick');

    writer.closed.then(() => {
      // TODO: Is this expectation correct?
      t.equal(rsClosed, true, 'readable is closed at that point');
    })
    .catch(e => t.error(e));
  }, 0);
});

test('TransformStream: by default, closing the writable closes the readable after sync enqueues and async done', t => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      c.enqueue('x');
      c.enqueue('y');
      setTimeout(done, 50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  writer.closed.then(() => {
    return readableStreamToArray(ts.readable).then(chunks => {
      t.deepEqual(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
      t.end();
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream: by default, closing the writable closes the readable after async enqueues and async done', t => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      setTimeout(() => c.enqueue('x'), 10);
      setTimeout(() => c.enqueue('y'), 50);
      setTimeout(done, 90);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  writer.closed.then(() => {
    return readableStreamToArray(ts.readable).then(chunks => {
      t.deepEqual(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
      t.end();
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream flush is called immediately when the writable is closed, if no writes are queued', t => {
  let flushCalled = false;
  const ts = new TransformStream({
    transform() { },
    flush() {
      flushCalled = true;
    }
  });

  ts.writable.getWriter().close().then(() => {
    t.ok(flushCalled, 'closing the writable triggers the transform flush immediately');
    t.end();
  });
});

test('TransformStream flush is called after all queued writes finish, once the writable is closed', t => {
  let flushCalled = false;
  const ts = new TransformStream({
    transform(chunk, done) {
      setTimeout(done, 10);
    },
    flush() {
      flushCalled = true;
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();
  t.notOk(flushCalled, 'closing the writable does not immediately call flush if writes are not finished');

  let rsClosed = false;
  ts.readable.getReader().closed.then(() => {
    rsClosed = true;
  });

  setTimeout(() => {
    t.ok(flushCalled, 'flush is eventually called');
    t.equal(rsClosed, false, 'if flush does not call close, the readable does not become closed');
    t.end();
  }, 50);
});

test('TransformStream flush gets a chance to enqueue more into the readable', t => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      done();
    },
    flush() {
      c.enqueue('x');
      c.enqueue('y');
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'x', done: false }, 'the first chunk read is the first one enqueued in flush');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'y', done: false }, 'the second chunk read is the second one enqueued in flush');
      t.end();
    });
  })
  .catch(e => t.error(e));
});

test('TransformStream flush gets a chance to enqueue more into the readable, and can then async close', t => {
  t.plan(3);

  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk, done) {
      done();
    },
    flush() {
      c.enqueue('x');
      c.enqueue('y');
      setTimeout(() => c.close(), 10);
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'x', done: false }, 'the first chunk read is the first one enqueued in flush');

    return reader.read().then(result2 => {
      t.deepEqual(result2, { value: 'y', done: false }, 'the second chunk read is the second one enqueued in flush');
    });
  })
  .catch(e => t.error(e));

  reader.closed.then(() => {
    t.pass('readable reader becomes closed');
  })
  .catch(e => t.error(e));
});

test('Transform stream should call transformer methods as methods', t => {
  t.plan(1);

  let c;
  const ts = new TransformStream({
    suffix: '-suffix',

    start(controller) {
      c = controller;
    },

    transform(chunk, done) {
      c.enqueue(chunk + this.suffix);
      done();
    },

    flush() {
      c.enqueue('flushed' + this.suffix);
      c.close();
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  writer.closed.then(() => {
    return readableStreamToArray(ts.readable).then(chunks => {
      t.deepEqual(chunks, ['a-suffix', 'flushed-suffix'], 'both enqueued chunks have suffixes');
    });
  }, e => t.error(e));
});

test('TransformStream cannot be used after becoming errored', t => {
  t.plan(1);
  new TransformStream({
    start(c) {
      c.enqueue('a');
      c.error(new Error('generic error'));
      t.throws(() => c.enqueue('b'), /TypeError/, 'Errored TransformStream cannot enqueue new chunks');
    },
    transform() {
    }
  });
});
