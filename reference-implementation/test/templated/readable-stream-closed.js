const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

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

  test('piping to a WritableStream in the writable state with { preventClose: true } should do nothing', t => {
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

      return rs.pipeTo(ws, { preventClose: true }).then(() => {
        t.pass('pipeTo promise should be fulfilled');
        t.equal(ws.state, 'writable', 'writable stream should still be writable');
      });
    })
    .catch(e => t.error(e));
  });
};
