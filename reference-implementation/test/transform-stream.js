'use strict';
const test = require('tape-catch');

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
