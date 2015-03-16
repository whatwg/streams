const tapeTest = require('tape-catch');

export default (label, factory, chunks) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('piping with no options and no destination errors', t => {
    const rs = factory();

    const chunksWritten = [];
    const ws = new WritableStream({
      abort() {
        t.fail('unexpected abort call');
      },
      write(chunk) {
        chunksWritten.push(chunk);
      }
    });

    rs.pipeTo(ws).then(() => {
      t.equal(ws.state, 'closed', 'destination should be closed');
      t.deepEqual(chunksWritten, chunks);
      t.end();
    });
  });

  test('piping with { preventClose: false } and no destination errors', t => {
    const rs = factory();

    const chunksWritten = [];
    const ws = new WritableStream({
      abort() {
        t.fail('unexpected abort call');
      },
      write(chunk) {
        chunksWritten.push(chunk);
      }
    });

    rs.pipeTo(ws).then(() => {
      t.equal(ws.state, 'closed', 'destination should be closed');
      t.deepEqual(chunksWritten, chunks);
      t.end();
    });
  });

  test('piping with { preventClose: true } and no destination errors', t => {
    const rs = factory();

    const chunksWritten = [];
    const ws = new WritableStream({
      close() {
        t.fail('unexpected close call');
      },
      abort() {
        t.fail('unexpected abort call');
      },
      write(chunk) {
        chunksWritten.push(chunk);
      }
    });

    rs.pipeTo(ws, { preventClose: true }).then(() => {
      t.equal(ws.state, 'writable', 'destination should be writable');
      t.deepEqual(chunksWritten, chunks);
      t.end();
    });
  });
};

