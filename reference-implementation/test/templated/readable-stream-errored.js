const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('closed should reject with the error', t => {
    t.plan(1);
    const rs = factory();

    rs.closed.then(
      () => t.fail('closed should not fulfill'),
      r => t.equal(r, error, 'closed should reject with the error')
    );
  });

  test('piping to a WritableStream in the writable state should abort the writable stream', t => {
    t.plan(4);

    const rs = factory();

    const startPromise = Promise.resolve();
    const ws = new WritableStream({
      start() {
        return startPromise;
      },
      write() {
        t.fail('Unexpected write call');
      },
      close() {
        t.fail('Unexpected close call');
      },
      abort(reason) {
        t.equal(reason, error);
      }
    });

    startPromise.then(() => {
      t.equal(ws.state, 'writable');

      rs.pipeTo(ws).finished.then(
        () => t.fail('pipeTo finished promise should not be fulfilled'),
        e => {
          t.equal(e, error, 'pipeTo finished promise should be rejected with the passed error');
          t.equal(ws.state, 'errored', 'writable stream should become errored');
        }
      );
    });
  });

  test('unpiping should be a no-op after the pipe fails', t => {
    t.plan(2);

    const rs = factory();
    const ws = new WritableStream();
    const pipe = rs.pipeTo(ws);

    pipe.finished.catch(e => {
      t.equal(e, error, 'pipeTo finished promise should be rejected with the passed error');

      return pipe.unpipe().then(v => {
        t.equal(v, undefined, 'unpipe() should fulfill with undefined');
      });
    })
    .catch(e => t.error(e));
  });

  test('getReader() should return a reader that acts errored', t => {
    t.plan(2);
    const rs = factory();

    const reader = rs.getReader();

    reader.closed.catch(e => t.equal(e, error, 'reader.closed should reject with the error'));
    reader.read().catch(e => t.equal(e, error, 'reader.read() should reject with the error'));
  });
};
