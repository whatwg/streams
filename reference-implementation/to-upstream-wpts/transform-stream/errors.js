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

  writer.write('a');
  return Promise.all([
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
