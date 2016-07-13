'use strict';
const tapeTest = require('tape-catch');

module.exports = (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('piping to a WritableStream in the writable state should close the writable stream', t => {
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
        t.pass('underlying source close should be called');
      },
      abort() {
        t.fail('Unexpected abort call');
      }
    });

    startPromise.then(() => {
      return rs.pipeTo(ws).then(() => {
        t.pass('pipeTo promise should be fulfilled');
      });
    })
    .catch(e => t.error(e));
  });

  test('piping to a WritableStream in the writable state with { preventClose: true } should do nothing', t => {
    t.plan(1);

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
      return rs.pipeTo(ws, { preventClose: true }).then(() => {
        t.pass('pipeTo promise should be fulfilled');
      });
    })
    .catch(e => t.error(e));
  });
};
