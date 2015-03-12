const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('closed should fulfill with undefined', t => {
    t.plan(1);
    const rs = factory();

    rs.closed.then(
      v => t.equal(v, undefined, 'closed should fulfill with undefined'),
      () => t.fail('closed should not reject')
    );
  });

  test('cancel() should return a distinct fulfilled promise each time', t => {
    t.plan(5);
    const rs = factory();

    const cancelPromise1 = rs.cancel();
    const cancelPromise2 = rs.cancel();
    const closedPromise = rs.closed;

    cancelPromise1.then(v => t.equal(v, undefined, 'first cancel() call should fulfill with undefined'));
    cancelPromise2.then(v => t.equal(v, undefined, 'second cancel() call should fulfill with undefined'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
    t.notEqual(cancelPromise1, closedPromise, 'cancel() promise 1 should be distinct from closed');
    t.notEqual(cancelPromise2, closedPromise, 'cancel() promise 2 should be distinct from closed');
  });

  test('getReader() should throw a TypeError', t => {
    t.plan(1);
    const rs = factory();

    t.throws(() => rs.getReader(), /TypeError/, 'getReader() should fail');
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
      t.equal(ws.state, 'writable', 'writable stream should start in writable state');

      rs.pipeTo(ws).then(
        () => t.fail('pipeTo promise should not fulfill'),
        e => {
          t.equal(e.constructor, TypeError, 'pipeTo promise should be rejected with a TypeError');
          t.equal(ws.state, 'writable', 'writable stream should still be writable');
        }
      );
    });
  });
};
