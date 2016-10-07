'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

function writeArrayToStream(array, writableStreamWriter) {
  array.forEach(chunk => writableStreamWriter.write(chunk));
  return writableStreamWriter.close();
}

promise_test(t => {
  let storage;
  const ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk) {
      return new Promise(resolve => {
        setTimeout(() => {
          storage.push(chunk);
          resolve();
        }, 0);
      });
    },

    close() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }
  });

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  return writeArrayToStream(input, writer)
      .then(() => assert_array_equals(storage, input, 'correct data should be relayed to underlying sink'));
}, 'WritableStream should complete asynchronous writes before close resolves');

promise_test(t => {
  let storage;
  const ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk) {
      storage.push(chunk);
    }
  });

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  return writeArrayToStream(input, writer)
      .then(() => assert_array_equals(storage, input, 'correct data should be relayed to underlying sink'));
}, 'WritableStream should complete synchronous writes before close resolves');

promise_test(t => {
  const ws = new WritableStream({
    write() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const writePromise = writer.write('a');
  return writePromise
      .then(value => assert_equals(value, undefined, 'fulfillment value must be undefined'));
}, 'fulfillment value of ws.write() call should be undefined even if the underlying sink returns a non-undefined ' +
    'value');

async_test(t => {
  let resolveSinkWritePromise;
  const ws = new WritableStream({
    write() {
      const sinkWritePromise = new Promise(resolve => {
        resolveSinkWritePromise = resolve;
      });
      return sinkWritePromise;
    }
  });

  const writer = ws.getWriter();

  setTimeout(t.step_func(() => {
    assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

    writer.ready.then(t.step_func(() => {
      const writePromise = writer.write('a');
      let writePromiseResolved = false;
      assert_not_equals(resolveSinkWritePromise, undefined, 'resolveSinkWritePromise should not be undefined');

      assert_equals(writer.desiredSize, 0, 'desiredSize should be 0 after writer.write()');

      writePromise.then(t.step_func(value => {
        writePromiseResolved = true;
        assert_equals(resolveSinkWritePromise, undefined, 'sinkWritePromise should be fulfilled before writePromise');

        assert_equals(value, undefined, 'writePromise should be fulfilled with undefined');
      }));

      writer.ready.then(t.step_func(value => {
        assert_equals(resolveSinkWritePromise, undefined, 'sinkWritePromise should be fulfilled before writer.ready');
        assert_true(writePromiseResolved, 'writePromise should be fulfilled before writer.ready');

        assert_equals(writer.desiredSize, 1, 'desiredSize should be 1 again');

        assert_equals(value, undefined, 'writePromise should be fulfilled with undefined');
        t.done();
      }));

      setTimeout(() => {
        resolveSinkWritePromise();
        resolveSinkWritePromise = undefined;
      }, 100);
    }));
  }), 0);
}, 'WritableStream should transition to waiting until write is acknowledged');

async_test(t => {
  let sinkWritePromiseRejectors = [];
  const ws = new WritableStream({
    write() {
      const sinkWritePromise = new Promise((r, reject) => sinkWritePromiseRejectors.push(reject));
      return sinkWritePromise;
    }
  });

  const writer = ws.getWriter();

  setTimeout(t.step_func(() => {
    assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');

    const writePromise = writer.write('a');
    assert_equals(sinkWritePromiseRejectors.length, 1, 'there should be 1 rejector');
    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');

    const writePromise2 = writer.write('b');
    assert_equals(sinkWritePromiseRejectors.length, 1, 'there should be still 1 rejector');
    assert_equals(writer.desiredSize, -1, 'desiredSize should be -1');

    const closedPromise = writer.close();

    assert_equals(writer.desiredSize, -1, 'desiredSize should still be -1');

    const passedError = new Error('horrible things');

    Promise.all([
      promise_rejects(t, passedError, closedPromise,  'closedPromise should reject with passedError')
          .then(t.step_func(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                                'sinkWritePromise should reject before closedPromise'))),
      promise_rejects(t, passedError, writePromise, 'writePromise should reject with passedError')
          .then(t.step_func(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                                'sinkWritePromise should reject before writePromise'))),
      promise_rejects(t, passedError, writePromise2, 'writePromise2 should reject with passedError')
          .then(t.step_func(() => assert_equals(sinkWritePromiseRejectors.length, 0,
                                                'sinkWritePromise should reject before writePromise2')))
    ]).then(() => t.done());

    setTimeout(() => {
      sinkWritePromiseRejectors[0](passedError);
      sinkWritePromiseRejectors = [];
    }, 100);
  }), 0);
}, 'when write returns a rejected promise, queued writes and close should be cleared');

promise_test(t => {
  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    write() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  return promise_rejects(t, thrownError, writer.write('a'), 'write() should reject with thrownError')
      .then(() => promise_rejects(t, new TypeError(), writer.close(), 'close() should be rejected'));
}, 'when sink\'s write throws an error, the stream should become errored and the promise should reject');

async_test(t => {
  const numberOfWrites = 10000;

  let resolveFirstWritePromise;
  let writeCount = 0;
  const ws = new WritableStream({
    write() {
      ++writeCount;
      if (!resolveFirstWritePromise) {
        return new Promise(resolve => {
          resolveFirstWritePromise = resolve;
        });
      }
      return Promise.resolve();
    }
  });

  setTimeout(t.step_func(() => {
    const writer = ws.getWriter();

    for (let i = 1; i < numberOfWrites; ++i) {
      writer.write('a');
    }
    const writePromise = writer.write('a');

    assert_equals(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    writePromise
        .then(t.step_func(() => {
          assert_equals(writeCount, numberOfWrites, `should have called sink's write ${numberOfWrites} times`);
          t.done();
        }))
        .catch(t.step_func(() => assert_unreached('writePromise should not be rejected')));
  }), 0);
}, 'a large queue of writes should be processed completely');
