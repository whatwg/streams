'use strict';
const test = require('tape-catch');

test('Closing a writable stream with in-flight writes below the high water mark delays the close call properly', t => {
  t.plan(1);

  let isDone = false;
  const ws = new WritableStream(
    {
      write() {
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

  const writer = ws.getWriter();
  writer.write({ byteLength: 1024 });
  writer.close();
});
