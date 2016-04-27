'use strict';
const test = require('tape-catch');

test('Can construct a writable stream with a valid CountQueuingStrategy', t => {
  t.doesNotThrow(() => new WritableStream({}, new CountQueuingStrategy({ highWaterMark: 4 })));

  t.end();
});

test('Correctly governs the value of a WritableStream\'s state property (HWM = 0)', t => {
  const dones = Object.create(null);

  const ws = new WritableStream(
    {
      write(chunk) {
        return new Promise(resolve => dones[chunk] = resolve);
      }
    },
    new CountQueuingStrategy({ highWaterMark: 0 })
  );

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseA = ws.write('a');
    t.equal(ws.state, 'waiting', 'After 1 write, 0 of which finished, state should be \'waiting\'');

    const writePromiseB = ws.write('b');
    t.equal(ws.state, 'waiting', 'After 2 writes, 0 of which finished, state should be \'waiting\'');

    dones.a();
    writePromiseA.then(() => {
      t.equal(ws.state, 'waiting', 'After 2 writes, 1 of which finished, state should be \'waiting\'');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(ws.state, 'writable', 'After 2 writes, 2 of which finished, state should be \'writable\'');

        const writePromiseC = ws.write('c');
        t.equal(ws.state, 'waiting', 'After 3 writes, 2 of which finished, state should be \'waiting\'');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(ws.state, 'writable', 'After 3 writes, 3 of which finished, state should be \'writable\'');

          t.end();
        });
      });
    })
    .catch(t.error);
  }, 0);
});

test('Correctly governs the value of a WritableStream\'s state property (HWM = 4)', t => {
  const dones = Object.create(null);

  const ws = new WritableStream(
    {
      write(chunk) {
        return new Promise(resolve => dones[chunk] = resolve);
      }
    },
    new CountQueuingStrategy({ highWaterMark: 4 })
  );

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseA = ws.write('a');
    t.equal(ws.state, 'writable', 'After 1 write, 0 of which finished, state should be \'writable\'');

    const writePromiseB = ws.write('b');
    t.equal(ws.state, 'writable', 'After 2 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseC = ws.write('c');
    t.equal(ws.state, 'writable', 'After 3 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseD = ws.write('d');
    t.equal(ws.state, 'writable', 'After 4 writes, 0 of which finished, state should be \'writable\'');

    ws.write('e');
    t.equal(ws.state, 'waiting', 'After 5 writes, 0 of which finished, state should be \'waiting\'');

    ws.write('f');
    t.equal(ws.state, 'waiting', 'After 6 writes, 0 of which finished, state should be \'waiting\'');

    ws.write('g');
    t.equal(ws.state, 'waiting', 'After 7 writes, 0 of which finished, state should be \'waiting\'');

    dones.a();
    writePromiseA.then(() => {
      t.equal(ws.state, 'waiting', 'After 7 writes, 1 of which finished, state should be \'waiting\'');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(ws.state, 'waiting', 'After 7 writes, 2 of which finished, state should be \'waiting\'');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(ws.state, 'writable', 'After 7 writes, 3 of which finished, state should be \'writable\'');

          ws.write('h');
          t.equal(ws.state, 'waiting', 'After 8 writes, 3 of which finished, state should be \'waiting\'');

          dones.d();
          return writePromiseD.then(() => {
            t.equal(ws.state, 'writable', 'After 8 writes, 4 of which finished, state should be \'writable\'');

            ws.write('i');
            t.equal(ws.state, 'waiting', 'After 9 writes, 4 of which finished, state should be \'waiting\'');

            t.end();
          });
        });
      });
    })
    .catch(t.error);
  }, 0);
});
