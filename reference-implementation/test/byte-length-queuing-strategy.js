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

test('ByteLengthQueuingStrategy constructor behaves as expected with wrong arguments', t => {
  const highWaterMark = 1;
  const highWaterMarkObjectGetter = {
    get highWaterMark() { return highWaterMark; },
  };
  const error = new Error("wow!");
  const highWaterMarkObjectGetterThrowing = {
    get highWaterMark() { throw error; },
  };
  t.throws(() => new ByteLengthQueuingStrategy(), /TypeError/, 'construction fails with undefined');
  t.throws(() => new ByteLengthQueuingStrategy(null), /TypeError/, 'construction fails with null');
  t.doesNotThrow(() => new ByteLengthQueuingStrategy('potato'), 'construction succeeds with a random non-object type');
  t.doesNotThrow(() => new ByteLengthQueuingStrategy({}), 'construction succeeds with an object without hwm property');
  t.doesNotThrow(() => new ByteLengthQueuingStrategy(highWaterMarkObjectGetter), 'construction succeeds with an object with a hwm getter');
  t.throws(() => new ByteLengthQueuingStrategy(highWaterMarkObjectGetterThrowing), /wow/, 'construction fails with the error thrown by the getter');

  t.end();
});

test('ByteLengthQueuingStrategy size behaves as expected with wrong arguments', t => {
  const size = 1024;
  const chunk = { byteLength: size };
  const chunkGetter = {
    get byteLength() { return size; },
  }
  const error = new Error("wow!");
  const chunkGetterThrowing = {
    get byteLength() { throw error; },
  }
  t.throws(() => ByteLengthQueuingStrategy.prototype.size(), /TypeError/, 'size fails with undefined');
  t.throws(() => ByteLengthQueuingStrategy.prototype.size(null), /TypeError/, 'size fails with null');
  t.doesNotThrow(() => ByteLengthQueuingStrategy.prototype.size('potato'), 'size succeeds with a random non-object type');
  t.doesNotThrow(() => ByteLengthQueuingStrategy.prototype.size({}), 'size succeeds with an object without hwm property');
  t.doesNotThrow(() => ByteLengthQueuingStrategy.prototype.size(chunkGetter), 'size succeeds with an object with a hwm getter');
  t.throws(() => ByteLengthQueuingStrategy.prototype.size(chunkGetterThrowing), /wow/, 'size fails with the error thrown by the getter');

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
  const ws = new WritableStream(
    {
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
      }
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 1024 * 16 })
  );

  ws.write({ byteLength: 1024 });
  ws.close();
});
