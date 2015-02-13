const test = require('tape');

test('Can construct a ByteLengthQueuingStrategy with a valid high water mark', t => {
  const strategy = new ByteLengthQueuingStrategy({ highWaterMark: 4 });

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
