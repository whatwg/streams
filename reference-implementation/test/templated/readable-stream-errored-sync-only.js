const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('cancel() should return a distinct rejected promise each time', t => {
    t.plan(3);
    const rs = factory();

    const cancelPromise1 = rs.cancel();
    const cancelPromise2 = rs.cancel();

    cancelPromise1.catch(e => t.equal(e, error, 'first cancel() call should reject with the error'));
    cancelPromise2.catch(e => t.equal(e, error, 'second cancel() call should reject with the error'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
  });
};
