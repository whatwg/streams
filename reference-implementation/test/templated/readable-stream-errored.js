'use strict';
const tapeTest = require('tape-catch');

module.exports = (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('piping to a WritableStream in the writable state should abort the writable stream', t => {
    t.plan(2);

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
        t.equal(reason, error, 'abort() of the underlying source should be called with error');
      }
    });

    startPromise.then(() => {
      rs.pipeTo(ws).then(
        () => t.fail('pipeTo promise should not be fulfilled'),
        e => {
          t.equal(e, error, 'pipeTo promise should be rejected with the passed error');
        }
      );
    });
  });
};
