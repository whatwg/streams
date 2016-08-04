'use strict';
const tapeTest = require('tape-catch');

module.exports = (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('piping with no options', t => {
    t.plan(3);

    const rs = factory();

    const ws = new WritableStream({
      abort(r) {
        t.equal(r, error, 'reason passed to abort should equal the source error');
      }
    });

    rs.pipeTo(ws).catch(pipeE => {
      t.equal(pipeE, error, 'rejection reason of pipeToPromise should be the source error');

      ws.getWriter().closed.catch(closedE => t.equal(closedE.constructor, TypeError),
        'rejection reason of dest closed should be a TypeError');
    });
  });

  test('piping with { preventAbort: false }', t => {
    t.plan(3);

    const rs = factory();

    const ws = new WritableStream({
      abort(r) {
        t.equal(r, error, 'reason passed to abort should equal the source error');
      }
    });

    rs.pipeTo(ws, { preventAbort: false }).catch(pipeE => {
      t.equal(pipeE, error, 'rejection reason of pipeToPromise should be the source error');

      ws.getWriter().closed.catch(closedE => t.equal(closedE.constructor, TypeError),
        'rejection reason of dest closed should be a TypeError');
    });
  });

  test('piping with { preventAbort: true }', t => {
    t.plan(1);

    const rs = factory();

    const ws = new WritableStream({
      abort() {
        t.fail('underlying sink abort should not be called');
      }
    });

    rs.pipeTo(ws, { preventAbort: true }).catch(e => {
      t.equal(e, error, 'rejection reason of pipeToPromise should be the source error');
    });
  });
};
