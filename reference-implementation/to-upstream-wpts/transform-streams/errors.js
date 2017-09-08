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

promise_test(t => {
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();
  const closedPromise = writer.closed;
  return Promise.all([
    ts.readable.cancel(thrownError),
    promise_rejects(t, thrownError, closedPromise, 'closed should throw a TypeError')
  ]);
}, 'cancelling the readable side should error the writable');

promise_test(t => {
  let controller;
  const ts = new TransformStream({
    start(c) {
      controller = c;
    }
  });
  const writer = ts.writable.getWriter();
  const reader = ts.readable.getReader();
  const writePromise = writer.write('a');
  const closePromise = writer.close();
  controller.error(thrownError);
  return Promise.all([
    promise_rejects(t, thrownError, reader.closed, 'reader.closed should reject'),
    promise_rejects(t, thrownError, writePromise, 'writePromise should reject'),
    promise_rejects(t, thrownError, closePromise, 'closePromise should reject')]);
}, 'it should be possible to error the readable between close requested and complete');

promise_test(t => {
  const ts = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      controller.close();
      throw thrownError;
    }
  });
  const writePromise = ts.writable.getWriter().write('a');
  const closedPromise = ts.readable.getReader().closed;
  return Promise.all([
    promise_rejects(t, thrownError, writePromise, 'write() should reject'),
    promise_rejects(t, thrownError, closedPromise, 'reader.closed should reject')
  ]);
}, 'an exception from transform() should error the stream if close has been requested but not completed');

promise_test(t => {
  const ts = new TransformStream();
  const writer = ts.writable.getWriter();
  // The microtask following transformer.start() hasn't completed yet, so the abort is queued and not notified to the
  // TransformStream yet.
  const abortPromise = writer.abort(thrownError);
  const cancelPromise = ts.readable.cancel(new Error('cancel reason'));
  return Promise.all([
    abortPromise,
    cancelPromise,
    promise_rejects(t, new TypeError(), writer.closed, 'writer.closed should reject with a TypeError')]);
}, 'abort should set the close reason for the writable when it happens first during start');

promise_test(t => {
  let resolveTransform;
  const transformPromise = new Promise(resolve => {
    resolveTransform = resolve;
  });
  const ts = new TransformStream({
    transform() {
      return transformPromise;
    }
  }, { highWaterMark: 2 });
  const writer = ts.writable.getWriter();
  return delay(0).then(() => {
    const writePromise = writer.write();
    const abortPromise = writer.abort(thrownError);
    const cancelPromise = ts.readable.cancel(new Error('cancel reason'));
    resolveTransform();
    return Promise.all([
      writePromise,
      abortPromise,
      cancelPromise,
      promise_rejects(t, new TypeError(), writer.closed, 'writer.closed should reject with a TypeError')]);
  });
}, 'abort should set the close reason for the writable when it happens first during underlying sink write');

test(() => {
  new TransformStream({
    start(controller) {
      controller.error(thrownError);
      assert_throws(new TypeError(), () => controller.error(), 'error() should throw');
    }
  });
}, 'controller.error() throws the second time it is called');

promise_test(() => {
  let controller;
  const ts = new TransformStream({
    start(c) {
      controller = c;
    }
  });
  const cancelPromise = ts.readable.cancel();
  assert_throws(new TypeError(), () => controller.error(), 'error() should throw');
  return cancelPromise;
}, 'controller.error() throws after readable.cancel()');

promise_test(() => {
  let controller;
  const ts = new TransformStream({
    start(c) {
      controller = c;
    }
  });
  return ts.writable.abort().then(() => {
    assert_throws(new TypeError(), () => controller.error(), 'error() should throw');
  });
}, 'controller.error() throws after writable.abort() has completed');

promise_test(t => {
  let controller;
  const ts = new TransformStream({
    start(c) {
      controller = c;
    },
    transform() {
      throw thrownError;
    }
  }, undefined, { highWaterMark: Infinity });
  return promise_rejects(t, thrownError, ts.writable.getWriter().write(), 'write() should reject').then(() => {
    assert_throws(new TypeError(), () => controller.error(), 'error() should throw');
  });
}, 'controller.error() throws after a transformer method has thrown an exception');

done();
