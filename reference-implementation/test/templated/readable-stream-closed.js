const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('cancel() should return a distinct fulfilled promise each time', t => {
    t.plan(3);
    const rs = factory();

    const cancelPromise1 = rs.cancel();
    const cancelPromise2 = rs.cancel();

    cancelPromise1.then(v => t.equal(v, undefined, 'first cancel() call should fulfill with undefined'));
    cancelPromise2.then(v => t.equal(v, undefined, 'second cancel() call should fulfill with undefined'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
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

      return rs.pipeTo(ws).then(() => {
        t.pass('pipeTo promise should be fulfilled');
        t.equal(ws.state, 'closed', 'writable stream should become closed');
      });
    })
    .catch(e => t.error(e));
  });

  test('should be able to acquire multiple readers, since they are all auto-released', t => {
    const rs = factory();

    rs.getReader();

    t.doesNotThrow(() => rs.getReader(), 'getting a second reader should not throw');
    t.doesNotThrow(() => rs.getReader(), 'getting a third reader should not throw');
    t.end();
  });
};
