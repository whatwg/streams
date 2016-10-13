'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
}

promise_test(t => {
  const ws = new WritableStream({
    close() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const closePromise = writer.close();
  return closePromise.then(value => assert_equals(value, undefined, 'fulfillment value must be undefined'));
}, 'fulfillment value of ws.close() call must be undefined even if the underlying sink returns a non-undefined ' +
    'value');

promise_test(t => {
  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      return delay(50);
    }
  });

  const writer = ws.getWriter();

  writer.close();

  return Promise.all([
    delay(10).then(() => controller.error(passedError)),
    promise_rejects(t, passedError, writer.closed,
                    'closed promise should be rejected with the passed error'),
    delay(70).then(() => promise_rejects(t, passedError, writer.closed, 'closed should stay rejected'))
  ]);
}, 'when sink calls error asynchronously while closing, the stream should become errored');

promise_test(t => {
  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      controller.error(passedError);
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, passedError, writer.close(), 'close promise should be rejected with the passed error')
      .then(() => promise_rejects(t, passedError, writer.closed, 'closed should stay rejected'));
}, 'when sink calls error synchronously while closing, the stream should become errored');

async_test(t => {
  const ws = new WritableStream({
    write() {
      t.step(() => {
        assert_unreached('Unexpected write call');
      });
    },
    abort() {
      t.step(() => {
        assert_unreached('Unexpected abort call');
      });
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(t.step_func(() => {
    writer.ready.then(t.step_func(() => {
      assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

      writer.close();
      assert_equals(writer.desiredSize, 1, 'desiredSize should be still 1');

      writer.ready.then(t.step_func(v => {
        assert_equals(v, undefined, 'ready promise was fulfilled with undefined');
        t.done();
      }));
    }));
  }), 0);
}, 'If close is called on a WritableStream in writable state, ready will return a fulfilled promise');

async_test(t => {
  const ws = new WritableStream({
    write() {
      return new Promise(() => {});
    },
    abort() {
      t.step(() => {
        assert_unreached('Unexpected abort call');
      });
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(t.step_func(() => {
    writer.write('a');

    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');

    let closeCalled = false;

    writer.ready.then(t.step_func(v => {
      if (closeCalled === false) {
        assert_unreached('ready fulfilled before writer.close()');
        return;
      }

      assert_equals(v, undefined, 'ready promise was fulfilled with undefined');
      t.done();
    }));

    setTimeout(t.step_func(() => {
      writer.close();
      closeCalled = true;
    }), 100);
  }), 0);
}, 'If close is called on a WritableStream in waiting state, ready promise will fulfill');

async_test(t => {
  let readyFulfilledAlready = false;
  const ws = new WritableStream({
    abort() {
      t.step(() => {
        assert_unreached('Unexpected abort call');
      });
    },
    close() {
      return new Promise(resolve => {
        setTimeout(t.step_func(() => {
          t.ok(readyFulfilledAlready, 'ready should have fulfilled already');
          resolve();
        }), 50);
      });
    }
  });

  // Wait for ws to start.
  setTimeout(t.step_func(() => {
    const writer = ws.getWriter();

    writer.write('a');

    writer.close();

    writer.ready.then(t.step_func(v => {
      readyFulfilledAlready = true;
      assert_equals(v, undefined, 'ready promise was fulfilled with undefined');
      t.done();
    }));
  }), 0);
}, 'If close is called on a WritableStream in waiting state, ready will be fulfilled immediately even if close ' +
    'takes a long time');
