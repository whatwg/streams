'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

const thrownError = new Error('bad things are happening!');
thrownError.name = 'error1';

promise_test(t => {
  const ts = new TransformStream({
    transform() {
      throw thrownError;
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();

  return Promise.all([
    promise_rejects(t, thrownError, writer.write('a'),
                    'writable\'s write should reject with the thrown error'),
    promise_rejects(t, thrownError, reader.read(),
                    'readable\'s read should reject with the thrown error'),
    promise_rejects(t, thrownError, reader.closed,
                    'readable\'s closed should be rejected with the thrown error'),
    promise_rejects(t, thrownError, writer.closed,
                    'writable\'s closed should be rejected with the thrown error')
  ]);
}, 'TransformStream errors thrown in transform put the writable and readable in an errored state');

promise_test(t => {
  const ts = new TransformStream({
    transform() {
    },
    flush() {
      throw thrownError;
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();

  return Promise.all([
    writer.write('a'),
    promise_rejects(t, thrownError, writer.close(),
                    'writable\'s close should reject with the thrown error'),
    promise_rejects(t, thrownError, reader.read(),
                    'readable\'s read should reject with the thrown error'),
    promise_rejects(t, thrownError, reader.closed,
                    'readable\'s closed should be rejected with the thrown error'),
    promise_rejects(t, thrownError, writer.closed,
                    'writable\'s closed should be rejected with the thrown error')
  ]);
}, 'TransformStream errors thrown in flush put the writable and readable in an errored state');

async_test(t => {
  new TransformStream({
    start(c) {
      t.step(() => {
        c.enqueue('a');
        c.error(new Error('generic error'));
        assert_throws(new TypeError(), () => c.enqueue('b'), 'Errored TransformStream cannot enqueue new chunks');
        t.done();
      });
    },
    transform() {
    }
  });
}, 'TransformStream cannot be used after becoming errored');

async_test(t => {
  const ts = new TransformStream({
    start() {
      return new Promise(resolve => setTimeout(resolve, 90))
        .then(() => { throw thrownError; });
    },
    transform() {
      t.step(() => assert_unreached('transform must never be called if start() fails'));
    },
    flush() {
      t.step(() => assert_unreached('flush must never be called if start() fails'));
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a').then(t.step_func(() => {
    assert_unreached('writer should be errored if start() fails');
  }))
  .catch(t.step_func(e => assert_equals(e, thrownError, 'writer rejects with same error')));
  writer.close().then(t.step_func(() => {
    assert_unreached('writer should be errored if start() fails');
  }))
  .catch(t.step_func(e => assert_equals(e, thrownError, 'writer rejects with same error')));

  const reader = ts.readable.getReader();

  reader.read().catch(t.step_func_done(e => {
    assert_equals(e, thrownError, 'reader rejects with same error');
  }));
}, 'TransformStream transformer.start() rejected promise errors the stream');

async_test(t => {
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
      t.step(() => assert_unreached('transform must never be called if start() fails'));
    },
    flush() {
      t.step(() => assert_unreached('flush must never be called if start() fails'));
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a').then(t.unreached_func('writer should be errored if start() fails'))
  .catch(t.step_func(e => assert_equals(e, controllerError, 'writer rejects with same error')));
  writer.close().then(t.unreached_func('writer should be errored if start() fails'))
  .catch(t.step_func(e => assert_equals(e, controllerError, 'writer rejects with same error')));

  const reader = ts.readable.getReader();

  reader.read().catch(t.step_func_done(e => {
    assert_equals(e, controllerError, 'reader rejects with same error');
  }));
}, 'TransformStream both calling controller.error and rejecting a promise');

test(() => {
  assert_throws(new URIError(), () => new TransformStream({
    start() { throw new URIError('start thrown error'); },
    transform() {}
  }), 'TransformStream constructor throws when start does');
}, 'TransformStream throw in transformer.start');

test(() => {
  const strategy = {
    size() { throw new URIError('size thrown error'); }
  };

  assert_throws(new URIError(), () => new TransformStream({
    start(c) {
      c.enqueue('a');
    },
    transform() {}
  }, undefined, strategy), 'throws same error strategy.size throws');
}, 'TransformStream throw in readableStrategy.size');

test(() => {
  const controllerError = new URIError('controller.error');

  let controller;
  const strategy = {
    size() {
      controller.error(controllerError);
      throw new Error('redundant error');
    }
  };

  assert_throws(new URIError(), () => new TransformStream({
    start(c) {
      controller = c;
      c.enqueue('a');
    },
    transform() {}
  }, undefined, strategy), 'first error gets thrown');
}, 'TransformStream throw in tricky readableStrategy.size');

test(t => {
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();
  const closedPromise = writer.closed;
  return Promise.all([
    ts.readable.cancel(thrownError),
    promise_rejects(t, thrownError, closedPromise, 'closed should throw a TypeError')
  ]);
}, 'cancelling the readable side should error the writable');

done();
