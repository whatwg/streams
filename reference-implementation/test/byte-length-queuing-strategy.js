const test = require('tape-catch');

test('Can construct a ByteLengthQueuingStrategy with a valid high water mark', t => {
  const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 4 });

  t.end();
});

test('Can construct a ByteLengthQueuingStrategy with any value as its high water mark', t => {
  for (const highWaterMark of [-Infinity, NaN, 'foo', {}, function () {}]) {
    const strategy = new ByteLengthQueuingStrategy({ highWaterMark });
    t.ok(Object.is(strategy.highWaterMark, highWaterMark), `${highWaterMark} gets set correctly`);
  }

  t.end();
});

test('ByteLengthQueuingStrategy instances have the correct properties', t => {
  const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 4 });

  t.deepEqual(Object.getOwnPropertyDescriptor(strategy, 'highWaterMark'),
    { value: 4, writable: true, enumerable: true, configurable: true },
    'highWaterMark property should be a data property with the value passed the connstructor');
  t.equal(typeof strategy.size, 'function');

  t.end();
});

test('Closing a writable stream with in-flight writes below the high water mark delays the close call properly', t => {
  t.plan(1);

  let isDone = false;
  const ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => {
        setTimeout(() => {
          isDone = true;
          resolve();
        }, 200);
      });
    },

    close() {
      t.true(isDone, 'close is only called once the promise has been resolved');
    },

    strategy: new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 16 })
  });

  ws.write({ byteLength: 1024 });
  ws.close();
});
