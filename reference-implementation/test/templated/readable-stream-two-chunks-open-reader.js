const tapeTest = require('tape-catch');

export default (label, factory, chunks) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('calling read() twice without waiting will eventually give both chunks', t => {
    t.plan(2);
    const { reader } = factory();

    reader.read().then(r => t.deepEqual(r, { value: chunks[0], done: false }, 'first result should be correct'));
    reader.read().then(r => t.deepEqual(r, { value: chunks[1], done: false }, 'second result should be correct'));
  });

  test('calling read() twice with waiting will eventually give both chunks', t => {
    t.plan(2);
    const { reader } = factory();

    reader.read().then(r => {
      t.deepEqual(r, { value: chunks[0], done: false }, 'first result should be correct');

      return reader.read().then(r => {
        t.deepEqual(r, { value: chunks[1], done: false }, 'second result should be correct');
      });
    })
    .catch(e => t.error(e));
  });

  test('read() should return distinct promises each time', t => {
    t.plan(1);
    const { reader } = factory();

    t.notEqual(reader.read(), reader.read(), 'the promises returned should be distinct');
  });

  test('cancel() after a read() should still give that single read result', t => {
    t.plan(4);
    const { stream, reader } = factory();

    stream.closed.then(v => t.equal(v, undefined, 'stream closed should fulfill with undefined'));
    reader.closed.then(v => t.equal(v, undefined, 'reader closed should fulfill with undefined'));

    reader.read().then(r => t.deepEqual(r, { value: chunks[0], done: false },
      'promise returned before cancellation should fulfill with a chunk'));

    reader.cancel();

    reader.read().then(r => t.deepEqual(r, { value: undefined, done: true },
      'promise returned after cancellation should fulfill with an end-of-stream signal'));
  });
};
