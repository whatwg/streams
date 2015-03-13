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

    rs.pipeTo(ws).finished.then(() => {
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

    rs.pipeTo(ws).finished.then(() => {
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

    rs.pipeTo(ws, { preventClose: true }).finished.then(() => {
      t.equal(ws.state, 'writable', 'destination should be writable');
      t.deepEqual(chunksWritten, chunks);
      t.end();
    });
  });

  test('piping and then immediately unpiping', t => {
    t.plan(5);
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

    const pipe = rs.pipeTo(ws);

    let unpipeFulfilled = false;

    pipe.unpipe().then(() => {
      unpipeFulfilled = true;

      let reader;
      t.doesNotThrow(() => { reader = rs.getReader(); },
        'should be able to get a reader after unpipe promise fulfills');

      reader.read().then(r => {
        t.deepEqual(r, { value: chunks[1], done: false }, 'reading from the reader should give the second chunk');
      });
    });

    pipe.finished.then(v => {
      t.equal(v, undefined, 'pipeTo finished promise should fulfill with undefined');
      t.equal(unpipeFulfilled, false, 'pipeTo finished promise should fulfill before the unpipe promise');
    });

    t.throws(() => rs.getReader(), TypeError, 'should not be able to get a reader immediately after unpipe call');
  });
};

