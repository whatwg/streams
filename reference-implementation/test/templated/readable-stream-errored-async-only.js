const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('piping with no options', t => {
    t.plan(4);
    const rs = factory();

    const ws = new WritableStream({
      abort(r) {
        t.equal(r, error, 'reason passed to abort should equal the source error');
      }
    });

    rs.pipeTo(ws).finished.catch(e => {
      t.equal(ws.state, 'errored', 'destination should be errored');
      t.equal(e, error, 'pipeTo finished promise should reject with the source error');
    });

    ws.closed.catch(e => t.equal(e, error), 'rejection reason of dest closed should be the source error');
  });

  test('piping with { preventAbort: false }', t => {
    t.plan(4);
    const rs = factory();

    const ws = new WritableStream({
      abort(r) {
        t.equal(r, error, 'reason passed to abort should equal the source error');
      }
    });

    rs.pipeTo(ws, { preventAbort: false }).finished.catch(e => {
      t.equal(ws.state, 'errored', 'destination should be errored');
      t.equal(e, error, 'pipeTo finished promise should reject with the source error');
    });

    ws.closed.catch(e => t.equal(e, error), 'rejection reason of dest closed should be the source error');
  });

  test('piping with { preventAbort: true }', t => {
    t.plan(2);
    const rs = factory();

    const ws = new WritableStream({
      abort() {
        t.fail('underlying sink abort should not be called');
      }
    });

    rs.pipeTo(ws, { preventAbort: true }).finished.catch(e => {
      t.equal(ws.state, 'writable', 'destination should remain writable');
      t.equal(e, error, 'pipeTo finished promise should reject with the source error');
    });
  });
};
