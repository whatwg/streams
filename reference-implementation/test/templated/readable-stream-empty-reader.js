const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('instances have the correct methods and properties', t => {
    const { reader } = factory();

    t.ok(reader.closed, 'has a closed property');
    t.equal(typeof reader.closed.then, 'function', 'closed property is thenable');

    t.equal(typeof reader.cancel, 'function', 'has a cancel method');
    t.equal(typeof reader.read, 'function', 'has a read method');
    t.equal(typeof reader.releaseLock, 'function', 'has a releaseLock method');

    t.end();
  });

  test('read() should never settle', t => {
    const { reader } = factory();

    reader.read().then(
      () => t.fail('read() should not fulfill'),
      () => t.fail('read() should not reject')
    );

    setTimeout(() => t.end(), 100);
  });

  test('two read()s should both never settle', t => {
    const { reader } = factory();

    reader.read().then(
      () => t.fail('first read() should not fulfill'),
      () => t.fail('first read() should not reject')
    );

    reader.read().then(
      () => t.fail('second read() should not fulfill'),
      () => t.fail('second read() should not reject')
    );

    setTimeout(() => t.end(), 100);
  });

  test('read() should return distinct promises each time', t => {
    t.plan(1);
    const { reader } = factory();

    t.notEqual(reader.read(), reader.read(), 'the promises returned should be distinct');
  });

  test('getReader() again on the stream should fail', t => {
    t.plan(1);
    const { stream } = factory();

    t.throws(() => stream.getReader(), /TypeError/, 'stream.getReader() should throw a TypeError');
  });

  test('releasing the lock with pending read requests should throw but the read requests should stay pending', t => {
    const { reader } = factory();

    reader.read().then(
      () => t.fail('first read() should not fulfill'),
      () => t.fail('first read() should not reject')
    );

    reader.read().then(
      () => t.fail('second read() should not fulfill'),
      () => t.fail('second read() should not reject')
    );

    reader.closed.then(
      () => t.fail('closed should not fulfill'),
      () => t.fail('closed should not reject')
    );

    t.throws(() => reader.releaseLock(), /TypeError/, 'releaseLock should throw a TypeError');

    setTimeout(() => t.end(), 50);
  });

  test('releasing the lock should cause further read() calls to resolve as if the stream is closed', t => {
    t.plan(2);
    const { reader } = factory();

    reader.releaseLock();

    reader.read().then(r =>
      t.deepEqual(r, { value: undefined, done: true }, 'first read() should return closed result'));
    reader.read().then(r =>
      t.deepEqual(r, { value: undefined, done: true }, 'second read() should return closed result'));
  });

  test('releasing the lock should cause closed to fulfill', t => {
    t.plan(2);
    const { reader } = factory();

    reader.closed.then(v => t.equal(v, undefined, 'reader.closed got before release should fulfill with undefined'));

    reader.releaseLock();

    reader.closed.then(v => t.equal(v, undefined, 'reader.closed got after release should fulfill with undefined'));
  });

  test('canceling via the reader should cause the reader to act closed', t => {
    t.plan(1);
    const { reader } = factory();

    reader.cancel();
    reader.read().then(r => t.deepEqual(r, { value: undefined, done: true },
      'read()ing from the reader should give a done result'))
  });

  test('canceling via the stream should fail', t => {
    t.plan(1);
    const { stream, reader } = factory();

    stream.cancel().catch(e => t.equal(e.constructor, TypeError, 'cancel() should reject with a TypeError'));
  });
};
