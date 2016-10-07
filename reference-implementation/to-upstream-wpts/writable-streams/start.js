'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

async_test(t => {
  let expectWriteCall = false;

  let resolveStartPromise;
  const ws = new WritableStream({
    start() {
      return new Promise(resolve => {
        resolveStartPromise = resolve;
      });
    },
    write(chunk) {
      t.step(() => {
        assert_true(expectWriteCall, 'write should not be called until start promise resolves');
        assert_equals(chunk, 'a', 'chunk should be the value passed to write');
        t.done();
      });
    },
    close() {
      t.step(() => {
        assert_unreached('close should not be called');
        t.done();
      });
    }
  });

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');
  writer.write('a');
  assert_equals(writer.desiredSize, 0, 'desiredSize should be 0 after writer.write()');

  // Wait and verify that write isn't be called.
  setTimeout(() => {
    expectWriteCall = true;
    resolveStartPromise();
  }, 100);
}, 'underlying sink\'s write should not be called until start finishes');

async_test(t => {
  let expectCloseCall = false;

  let resolveStartPromise;
  const ws = new WritableStream({
    start() {
      return new Promise(resolve => {
        resolveStartPromise = resolve;
      });
    },
    write() {
      t.step(() => assert_unreached('write could not be called'));
    },
    close() {
      t.step(() => {
        assert_true(expectCloseCall, 'close should not be called until start promise resolves');
        t.done();
      });
    }
  });

  const writer = ws.getWriter();

  writer.close('a');
  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

  // Wait and see that write won't be called.
  setTimeout(() => {
    expectCloseCall = true;
    resolveStartPromise();
  }, 100);
}, 'underlying sink\'s close should not be called until start finishes');

test(t => {
  const passedError = new Error('horrible things');

  assert_throws(passedError, () => {
    new WritableStream({
      start() {
        throw passedError;
      },
      write() {
        assert_unreached('write should not be called');
      },
      close() {
        assert_unreached('close should not be called');
      }
    });
  }, 'constructor should throw passedError');
}, 'underlying sink\'s write or close should not be called if start throws');

async_test(t => {
  new WritableStream({
    start() {
      return Promise.reject();
    },
    write() {
      t.step(() => assert_unreached('write should not be called'));
    },
    close() {
      t.step(() => assert_unreached('close should not be called'));
    }
  });

  // Wait and verify that write or close won't be called.
  setTimeout(() => t.done(), 100);
}, 'underlying sink\'s write or close should not be invoked if the promise returned by start is rejected');
