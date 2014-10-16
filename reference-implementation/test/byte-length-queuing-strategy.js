var test = require('tape');

import ByteLengthQueuingStrategy from '../lib/byte-length-queuing-strategy';
import WritableStream from '../lib/writable-stream';

test('Can construct a ByteLengthQueuingStrategy with a valid high water mark', t => {
  var strategy = new ByteLengthQueuingStrategy({ highWaterMark: 4 });

  t.end();
});

test('Closing a writable stream with in-flight writes below the high water mark delays the close call properly', t => {
  t.plan(1);

  var isDone = false;
  var ws = new WritableStream({
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
