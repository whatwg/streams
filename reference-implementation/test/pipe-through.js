'use strict';
const test = require('tape-catch');

// FIXME: expected results here will probably change as we fix https://github.com/whatwg/streams/issues/190
// As they are now they don't make very much sense, so we will skip the test. When #190 is fixed, we should fix the
// test and re-enable.
test.skip('Piping through a default transform stream causes backpressure to be exerted after some delay', t => {
  t.plan(2);

  // Producer: every 20 ms
  const enqueueReturnValues = [];
  const rs = new ReadableStream({
    start(c) {
      setTimeout(() => enqueueReturnValues.push(c.enqueue('a')), 10);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('b')), 30);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('c')), 50);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('d')), 70);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('e')), 90);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('f')), 110);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('g')), 130);
      setTimeout(() => enqueueReturnValues.push(c.enqueue('h')), 150);
      setTimeout(() => c.close(), 170);
    }
  });

  let c;

  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk) {
      c.enqueue(chunk);
    }
  });

  // Consumer: every 90 ms
  const writtenValues = [];
  const ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => {
        setTimeout(() => {
          writtenValues.push(chunk);
          resolve();
        }, 90);
      });
    }
  });

  setTimeout(() => {
    rs.pipeThrough(ts).pipeTo(ws).then(() => {
      t.deepEqual(
        enqueueReturnValues,
        [true, true, true, true, false, false, false, false],
        'backpressure was correctly exerted at the source');
      t.deepEqual(writtenValues, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'all chunks were written');
    });
  }, 0);
});
