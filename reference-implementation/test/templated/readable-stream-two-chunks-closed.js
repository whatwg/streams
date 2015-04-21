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

  test('piping with { preventClose: false } and a destination with that errors synchronously', t => {
    t.plan(1);

    const rs = factory();

    const theError = new Error('!!!');
    const ws = new WritableStream({
      close() {
        t.fail('unexpected close call');
      },
      abort() {
        t.fail('unexpected abort call');
      },
      write() {
        throw theError;
      }
    });

    rs.pipeTo(ws, { preventClose: false }).then(
      () => t.fail('pipeTo promise should not fulfill'),
      e => t.equal(e, theError, 'pipeTo promise should reject with the write error')
    );
  });

  test('piping with { preventClose: true } and a destination with that errors synchronously', t => {
    t.plan(1);

    const rs = factory();

    const theError = new Error('!!!');
    const ws = new WritableStream({
      close() {
        t.fail('unexpected close call');
      },
      abort() {
        t.fail('unexpected abort call');
      },
      write() {
        throw theError;
      }
    });

    rs.pipeTo(ws, { preventClose: true }).then(
      () => t.fail('pipeTo promise should not fulfill'),
      e => t.equal(e, theError, 'pipeTo promise should reject with the write error')
    );
  });

  test('piping with { preventClose: true } and a destination that errors on the last chunk', t => {
    t.plan(1);

    const rs = factory();

    const theError = new Error('!!!');
    let chunkCounter = 0;
    const ws = new WritableStream(
      {
        close() {
          t.fail('unexpected close call');
        },
        abort() {
          t.fail('unexpected abort call');
        },
        write() {
          if (++chunkCounter === 2) {
            return new Promise((r, reject) => setTimeout(() => reject(theError), 50));
          }
        }
      },
      {
        highWaterMark: Infinity,
        size() { return 1; }
      }
    );

    rs.pipeTo(ws, { preventClose: true }).then(
      () => t.fail('pipeTo promise should not fulfill'),
      e => t.equal(e, theError, 'pipeTo promise should reject with the write error')
    );
  });
};

