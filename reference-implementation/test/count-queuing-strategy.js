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
    const writer = ws.getWriter();

    t.equal(writer.desiredSize, 0, 'desiredSize should be initially 0');

    const writePromiseA = writer.write('a');
    t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after 1st write()');

    const writePromiseB = writer.write('b');
    t.equal(writer.desiredSize, -2, 'desiredSize should be -2 after 2nd write()');

    dones.a();
    writePromiseA.then(() => {
      t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after completing 1st write()');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after completing 2nd write()');

        const writePromiseC = writer.write('c');
        t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after 3rd write()');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after completing 3rd write()');

          t.end();
        });
      });
    })
    .catch(e => t.error(e));
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
    const writer = ws.getWriter();

    t.equal(writer.desiredSize, 4, 'desiredSize should be initially 4');

    const writePromiseA = writer.write('a');
    t.equal(writer.desiredSize, 3, 'desiredSize should be 3 after 1st write()');

    const writePromiseB = writer.write('b');
    t.equal(writer.desiredSize, 2, 'desiredSize should be 2 after 2nd write()');

    const writePromiseC = writer.write('c');
    t.equal(writer.desiredSize, 1, 'desiredSize should be 1 after 3rd write()');

    const writePromiseD = writer.write('d');
    t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after 4th write()');

    writer.write('e');
    t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after 5th write()');

    writer.write('f');
    t.equal(writer.desiredSize, -2, 'desiredSize should be -2 after 6th write()');

    writer.write('g');
    t.equal(writer.desiredSize, -3, 'desiredSize should be -3 after 7th write()');

    dones.a();
    writePromiseA.then(() => {
      t.equal(writer.desiredSize, -2, 'desiredSize should be -2 after completing 1st write()');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after completing 2nd write()');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after completing 3rd write()');

          writer.write('h');
          t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after 8th write()');

          dones.d();
          return writePromiseD.then(() => {
            t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after completing 4th write()');

            writer.write('i');
            t.equal(writer.desiredSize, -1, 'desiredSize should be -1 after 9th write()');

            t.end();
          });
        });
      });
    })
    .catch(e => t.error(e));
  }, 0);
});
