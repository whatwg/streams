'use strict';
const test = require('tape-catch');

const readableStreamToArray = require('./utils/readable-stream-to-array.js');


test('Identity TransformStream: can read from readable what is put into writable', t => {
  t.plan(3);

  const ts = new TransformStream();

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

  const readableChunks = readableStreamToArray(ts.readable);

  writer.closed.then(() => {
    return readableChunks.then(chunks => {
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

  const readableChunks = readableStreamToArray(ts.readable);

  writer.closed.then(() => {
    return readableChunks.then(chunks => {
      t.deepEqual(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
      t.end();
    });
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

    transform(chunk) {
      c.enqueue(chunk + this.suffix);
    },

    flush() {
      c.enqueue('flushed' + this.suffix);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  const readableChunks = readableStreamToArray(ts.readable);

  writer.closed.then(() => {
    return readableChunks.then(chunks => {
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

test('TransformStream throw in readableStrategy.size', t => {
  t.plan(1);

  const strategy = {
    size() { throw new URIError('size thrown error'); }
  };

  t.throws(() => new TransformStream({
    start(c) {
      c.enqueue('a');
    },
    transform() {},
    readableStrategy: strategy
  }), /URIError.*size thrown error/, 'throws same error strategy.size throws');
});

test('TransformStream throw in tricky readableStrategy.size', t => {
  t.plan(1);

  const controllerError = new URIError('controller.error');

  let controller;
  const strategy = {
    size() {
      controller.error(controllerError);
      throw new URIError('redundant error');
    }
  };

  t.throws(() => new TransformStream({
    start(c) {
      controller = c;
      c.enqueue('a');
    },
    transform() {},
    readableStrategy: strategy
  }), /URIError.*controller\.error/, 'first error gets thrown');
});
