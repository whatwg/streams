const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('closed should reject with the error', t => {
    t.plan(2);
    const { stream, reader } = factory();

    stream.closed.then(
      () => t.fail('stream closed should not fulfill'),
      r => t.equal(r, error, 'stream closed should reject with the error')
    );

    reader.closed.then(
      () => t.fail('stream closed should not fulfill'),
      r => t.equal(r, error, 'stream closed should reject with the error')
    );
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
