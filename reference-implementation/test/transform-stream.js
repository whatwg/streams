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
    transform(chunk) {
      c.enqueue(chunk);
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
    transform(chunk) {
      c.enqueue(chunk.toUpperCase());
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
    transform(chunk) {
      c.enqueue(chunk.toUpperCase());
      c.enqueue(chunk.toUpperCase());
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
    transform(chunk) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      return new Promise(resolve => setTimeout(resolve, 50));
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
    transform(chunk) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 50);
      return new Promise(resolve => setTimeout(resolve, 90));
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
    transform() {
      return new Promise(resolve => setTimeout(resolve, 50));
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
    transform() {
      c.enqueue('x');
      c.enqueue('y');
      return new Promise(resolve => setTimeout(resolve, 50));
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
    transform() {
      setTimeout(() => c.enqueue('x'), 10);
      setTimeout(() => c.enqueue('y'), 50);
      return new Promise(resolve => setTimeout(resolve, 50));
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
    transform() {
      return new Promise(resolve => setTimeout(resolve, 10));
    },
    flush() {
      flushCalled = true;
      return new Promise(); // never resolves
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
    t.equal(rsClosed, false, 'if flushPromise does not resolve, the readable does not become closed');
    t.end();
  }, 50);
});

test('TransformStream flush gets a chance to enqueue more into the readable', t => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform() {
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
    transform() {
    },
    flush() {
      c.enqueue('x');
      c.enqueue('y');
      return new Promise(resolve => setTimeout(resolve, 10));
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
  t.plan(2);

  let c;
  const ts = new TransformStream({
    suffix: '-suffix',

    start(controller) {
      c = controller;
    },

    transform(chunk) {
      c.enqueue(chunk + this.suffix);
    },

    flush() {
      c.enqueue('flushed' + this.suffix);
      t.throws(() => c.close(), /TypeError/, 'A closing TransformStream cannot be closed again');
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

test('TransformStream start, transform, and flush are strictly ordered', t => {
  t.plan(4);
  let startCalled = false;
  let startDone = false;
  let transformDone = false;
  let flushDone = false;
  const ts = new TransformStream({
    start() {
      startCalled = true;
      return new Promise(resolve => setTimeout(resolve, 90))
        .then(() => { startDone = true; });
    },
    transform() {
      t.ok(startDone, 'startPromise must resolve before transform is called');
      return new Promise(resolve => setTimeout(resolve, 30))
        .then(() => { transformDone = true; });
    },
    flush() {
      t.ok(transformDone, 'pending transform promise must resolve before flush is called');
      return new Promise(resolve => setTimeout(resolve, 50))
        .then(() => { flushDone = true; });
    }
  });

  t.ok(startCalled, 'start is called synchronously');

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close().then(() => {
    t.ok(flushDone, 'flushPromise resolved');
    t.end();
  })
  .catch(e => t.error(e));
});

test('TransformStream transformer.start() rejected promise errors the stream', t => {
  t.plan(2);
  const thrownError = new Error('start failure');
  const ts = new TransformStream({
    start() {
      return new Promise(resolve => setTimeout(resolve, 90))
        .then(() => { throw thrownError; });
    },
    transform() {
      t.fail('transform must never be called if start() fails');
    },
    flush() {
      t.fail('flush must never be called if start() fails');
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close().then(() => {
    t.fail('writer should be errored if start() fails');
  })
  .catch(e => t.equal(e, thrownError, 'writer rejects with same error'));

  const reader = ts.readable.getReader();

  reader.read().catch(e => t.equal(e, thrownError, 'reader rejects with same error'));
});

test('TransformStream both calling controller.error and rejecting a promise', t => {
  t.plan(2);
  const controllerError = new Error('start failure');
  const ts = new TransformStream({
    start(c) {
      return new Promise(resolve => setTimeout(resolve, 90))
        .then(() => {
          c.error(controllerError);
          throw new Error('ignored error');
        });
    },
    transform() {
      t.fail('transform must never be called if start() fails');
    },
    flush() {
      t.fail('flush must never be called if start() fails');
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close().then(() => {
    t.fail('writer should be errored if start() fails');
  })
  .catch(e => t.equal(e, controllerError, 'writer rejects with same error'));

  const reader = ts.readable.getReader();

  reader.read().catch(e => t.equal(e, controllerError, 'reader rejects with same error'));
});

test('TransformStream throw in transformer.start', t => {
  t.plan(1);
  t.throws(() => new TransformStream({
    start() { throw new URIError('start thrown error'); },
    transform() {}
  }), /URIError.*start thrown error/, 'TransformStream constructor throws when start does');
});
