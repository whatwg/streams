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

  test('getReader() should be OK', t => {
    t.plan(1);
    const rs = factory();

    t.doesNotThrow(() => rs.getReader(), 'getReader() should not throw');
  });

  test('piping to a WritableStream in the writable state should close the writable stream', t => {
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
        t.pass('underlying source close should be called');
      },
      abort() {
        t.fail('Unexpected abort call');
      }
    });

    startPromise.then(() => {
      t.equal(ws.state, 'writable', 'writable stream should start in writable state');

      rs.pipeTo(ws).finished.then(() => {
        t.pass('pipeTo finished promise should be fulfilled');
        t.equal(ws.state, 'closed', 'writable stream should become closed');
      });
    });
  });
};
