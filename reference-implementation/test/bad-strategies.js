'use strict';
const test = require('tape-catch');

test('Writable stream: throwing strategy.size getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({}, {
      get size() {
        throw theError;
      },
      highWaterMark: 5
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Writable stream: throwing strategy.size method', t => {
  t.plan(3);

  const theError = new Error('a unique string');
  let ws;
  t.doesNotThrow(() => {
    ws = new WritableStream({}, {
      size() {
        throw theError;
      },
      highWaterMark: 5
    });
  }, 'initial construction should not throw');

  const writer = ws.getWriter();
  writer.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  writer.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Writable stream: invalid strategy.size return value', t => {
  t.plan(8);

  for (const size of [NaN, -Infinity, +Infinity, -1]) {
    let theError;
    const ws = new WritableStream({}, {
      size() {
        return size;
      },
      highWaterMark: 5
    });

    const writer = ws.getWriter();
    writer.write('a').then(
      () => t.fail('write should not fulfill'),
      r => {
        t.equal(r.constructor, RangeError, `write should reject with a RangeError for ${size}`);
        theError = r;
      });

    writer.closed.catch(e => t.equal(e, theError, `closed should reject with the error for ${size}`));
  }
});

test('Writable stream: throwing strategy.highWaterMark getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({}, {
      size() {
        return 1;
      },
      get highWaterMark() {
        throw theError;
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Writable stream: invalid strategy.highWaterMark', t => {
  t.plan(5);

  for (const highWaterMark of [-1, -Infinity, NaN, 'foo', {}]) {
    t.throws(() => {
      new WritableStream({}, {
        size() {
          return 1;
        },
        highWaterMark
      });
    }, /RangeError/, `construction should throw a RangeError for ${highWaterMark}`);
  }
});
