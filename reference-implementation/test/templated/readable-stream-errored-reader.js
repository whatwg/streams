const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('closed should reject with the error', t => {
    t.plan(1);
    const { reader } = factory();

    reader.closed.then(
      () => t.fail('stream closed should not fulfill'),
      r => t.equal(r, error, 'stream closed should reject with the error')
    );
  });

  test('releasing the lock should cause closed to reject and change identity', t => {
    t.plan(3);
    const { reader } = factory();

    const closedBefore = reader.closed;

    closedBefore.catch(e => {
      t.equal(e, error, 'reader.closed acquired before release should reject with the error');

      reader.releaseLock();
      const closedAfter = reader.closed;

      t.notEqual(closedBefore, closedAfter, 'the closed promise should change identity');

      return closedAfter.catch(e => {
        t.equal(e.constructor, TypeError, 'reader.closed acquired after release should reject with a TypeError');
      });
    })
    .catch(e => t.error(e));
  });

  test('read() should reject with the error', t => {
    t.plan(1);
    const { reader } = factory();

    reader.read().then(
      () => t.fail('read() should not fulfill'),
      r => t.equal(r, error, 'read() should reject with the error')
    );
  });
};
