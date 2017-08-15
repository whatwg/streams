'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
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

test(() => {
  new TransformStream({
    start(c) {
      c.enqueue('a');
      c.error(new Error('generic error'));
      assert_throws(new TypeError(), () => c.enqueue('b'), 'enqueue() should throw');
    }
  });
}, 'errored TransformStream should not enqueue new chunks');

promise_test(t => {
  const ts = new TransformStream({
    start() {
      return flushAsyncEvents().then(() => {
        throw thrownError;
      });
    },
    transform: t.unreached_func('transform should not be called'),
    flush: t.unreached_func('flush should not be called')
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  return Promise.all([
    promise_rejects(t, thrownError, writer.write('a'), 'writer should reject with thrownError'),
    promise_rejects(t, thrownError, writer.close(), 'close() should reject with thrownError'),
    promise_rejects(t, thrownError, reader.read(), 'reader should reject with thrownError')
  ]);
}, 'TransformStream transformer.start() rejected promise should error the stream');

promise_test(t => {
  const controllerError = new Error('start failure');
  controllerError.name = 'controllerError';
  const ts = new TransformStream({
    start(c) {
      return flushAsyncEvents()
        .then(() => {
          c.error(controllerError);
          throw new Error('ignored error');
        });
    },
    transform: t.unreached_func('transform should never be called if start() fails'),
    flush: t.unreached_func('flush should never be called if start() fails')
  });

  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  return Promise.all([
    promise_rejects(t, controllerError, writer.write('a'), 'writer should reject with controllerError'),
    promise_rejects(t, controllerError, writer.close(), 'close should reject with same error'),
    promise_rejects(t, controllerError, reader.read(), 'reader should reject with same error')
  ]);
}, 'when controller.error is followed by a rejection, the error reason should come from controller.error');

test(() => {
  assert_throws(new URIError(), () => new TransformStream({
    start() { throw new URIError('start thrown error'); },
    transform() {}
  }), 'constructor should throw');
}, 'TransformStream constructor should throw when start does');

test(() => {
  const strategy = {
    size() { throw new URIError('size thrown error'); }
  };

  assert_throws(new URIError(), () => new TransformStream({
    start(c) {
      c.enqueue('a');
    },
    transform() {}
  }, undefined, strategy), 'constructor should throw the same error strategy.size throws');
}, 'when strategy.size throws inside start(), the constructor should throw the same error');

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
  }, undefined, strategy), 'the first error should be thrown');
}, 'when strategy.size calls controller.error() then throws, the constructor should throw the first error');

done();
