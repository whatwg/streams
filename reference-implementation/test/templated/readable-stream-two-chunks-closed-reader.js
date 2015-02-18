const tapeTest = require('tape-catch');

export default (label, factory, chunks) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('third read(), without waiting, should give { value: undefined, done: true }', t => {
    t.plan(3);

    const { reader } = factory();

    reader.read().then(r => t.deepEqual(r, { value: chunks[0], done: false }, 'first result should be correct'));
    reader.read().then(r => t.deepEqual(r, { value: chunks[1], done: false }, 'second result should be correct'));
    reader.read().then(r => t.deepEqual(r, { value: undefined, done: true }, 'third result should be correct'));
  });

  test('third read, with waiting, should give { value: undefined, done: true }', t => {
    t.plan(3);

    const { reader } = factory();

    reader.read().then(r => {
      t.deepEqual(r, { value: chunks[0], done: false }, 'first result should be correct');

      return reader.read().then(r => {
        t.deepEqual(r, { value: chunks[1], done: false }, 'second result should be correct');

        return reader.read().then(r => {
          t.deepEqual(r, { value: undefined, done: true }, 'third result should be correct');
        });
      });
    })
    .catch(e => t.error(e));
  });

  test('draining the stream via read() should cause the stream and reader closed promises to fulfill', t => {
    t.plan(2);

    const { stream, reader } = factory();

    stream.closed.then(
      v => t.equal(v, undefined, 'stream closed should fulfill with undefined'),
      () => t.fail('stream closed should not reject')
    );

    reader.closed.then(
      v => t.equal(v, undefined, 'reader closed should fulfill with undefined'),
      () => t.fail('reader closed should not reject')
    );

    reader.read();
    reader.read();
  });

  test('releasing the lock after the stream is closed should do nothing', t => {
    t.plan(2);
    const { stream, reader } = factory();

    stream.closed.then(
      () => t.doesNotThrow(() => reader.releaseLock(), 'releasing the lock after stream closed should not throw')
    );

    reader.closed.then(
      () => t.doesNotThrow(() => reader.releaseLock(), 'releasing the lock after reader closed should not throw')
    );

    reader.read();
    reader.read();
  });

  test('releasing the lock should cause read() to act as if the stream is closed', t => {
    t.plan(3);
    const { reader } = factory();

    reader.releaseLock();

    reader.read().then(r =>
      t.deepEqual(r, { value: undefined, done: true }, 'first read() should return closed result'));
    reader.read().then(r =>
      t.deepEqual(r, { value: undefined, done: true }, 'second read() should return closed result'));
    reader.read().then(r =>
      t.deepEqual(r, { value: undefined, done: true }, 'third read() should return closed result'));
  });

  test('reader\'s closed property always returns the same promise', t => {
    t.plan(6);
    const { stream, reader } = factory();

    const readerClosed = reader.closed;

    t.notEqual(readerClosed, stream.closed, 'reader.closed is not equal to stream.closed');
    t.equal(reader.closed, readerClosed, 'accessing reader.closed twice in succession gives the same value');

    reader.read().then(() => {
      t.equal(reader.closed, readerClosed, 'reader.closed is the same after read() fulfills');

      reader.releaseLock();

      t.equal(reader.closed, readerClosed, 'reader.closed is the same after releasing the lock');

      stream.closed.then(() => {
        t.equal(reader.closed, readerClosed, 'reader.closed is the same after the stream is closed');
      });

      const newReader = stream.getReader();
      newReader.read();
    });

    t.equal(reader.closed, readerClosed, 'reader.closed is the same after calling read()');
  });
};
