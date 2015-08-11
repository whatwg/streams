const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('should be able to obtain a second reader, with the correct closed promise', t => {
    t.plan(2);
    const rs = factory();

    rs.getReader();

    let reader;
    t.doesNotThrow(() => reader = rs.getReader(),
      'calling getReader() twice does not throw (the stream is not locked)');

    reader.closed.then(
      () => t.fail('closed promise should not be fulfilled when stream is errored'),
      err => t.equal(err, error)
    );
  });

  test('cancel() should return a distinct rejected promise each time', t => {
    t.plan(3);
    const rs = factory();

    const cancelPromise1 = rs.cancel();
    const cancelPromise2 = rs.cancel();

    cancelPromise1.catch(e => t.equal(e, error, 'first cancel() call should reject with the error'));
    cancelPromise2.catch(e => t.equal(e, error, 'second cancel() call should reject with the error'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
  });

  test('reader cancel() should return a distinct rejected promise each time', t => {
    t.plan(3);
    const rs = factory();
    const reader = rs.getReader();

    const cancelPromise1 = reader.cancel();
    const cancelPromise2 = reader.cancel();

    cancelPromise1.catch(e => t.equal(e, error, 'first cancel() call should reject with the error'));
    cancelPromise2.catch(e => t.equal(e, error, 'second cancel() call should reject with the error'));
    t.notEqual(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
  });

  test('should be able to acquire multiple readers, since they are all auto-released', t => {
    const rs = factory();

    rs.getReader();

    t.doesNotThrow(() => rs.getReader(), 'getting a second reader should not throw');
    t.doesNotThrow(() => rs.getReader(), 'getting a third reader should not throw');
    t.end();
  });
};
