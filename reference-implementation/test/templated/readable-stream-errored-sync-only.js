const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('cancel() should return a distinct rejected promise each time', t => {
    t.plan(5);
    const rs = factory();

    const cancelPromise1 = rs.cancel();
    const cancelPromise2 = rs.cancel();
    const closedPromise = rs.closed;

    cancelPromise1.catch(e => t.equal(e, error, 'first cancel() call should reject with the error'));
    cancelPromise2.catch(e => t.equal(e, error, 'second cancel() call should reject with the error'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
    t.notEqual(cancelPromise1, closedPromise, 'cancel() promise 1 should be distinct from closed');
    t.notEqual(cancelPromise2, closedPromise, 'cancel() promise 2 should be distinct from closed');
  });
};
