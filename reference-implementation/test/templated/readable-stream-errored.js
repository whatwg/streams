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

  test('piping to a WritableStream in the writable state should fail', t => {
    t.plan(3);

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
      abort() {
        t.fail('Unexpected abort call');
      }
    });

    startPromise.then(() => {
      t.equal(ws.state, 'writable');

      rs.pipeTo(ws).then(
        () => t.fail('pipeTo promise should not be fulfilled'),
        e => {
          t.equal(e, error, 'pipeTo promise should be rejected with the passed error');
          t.equal(ws.state, 'writable', 'writable stream should still be writable');
        }
      );
    });
  });
};
