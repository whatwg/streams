'use strict';
const test = require('tape-catch');

const sequentialReadableStream = require('./utils/sequential-rs.js');
const duckTypedPassThroughTransform = require('./utils/duck-typed-pass-through-transform.js');
const readableStreamToArray = require('./utils/readable-stream-to-array.js');

test('Piping through a duck-typed pass-through transform stream works', t => {
  t.plan(1);

  const readableEnd = sequentialReadableStream(5).pipeThrough(duckTypedPassThroughTransform());

  readableStreamToArray(readableEnd).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});

test('Piping through an identity transform stream will close the destination when the source closes', t => {
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.enqueue('c');
      c.close();
    }
  });

  let enqueue;

  const ts = new TransformStream({
    start(e) {
      enqueue = e;
    },
    transform(chunk, done) {
      enqueue(chunk);
      done();
    }
  });

  const ws = new WritableStream();

  rs.pipeThrough(ts).pipeTo(ws).then(() => {
    t.end();
  })
  .catch(e => t.error(e));
});

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

  let enqueue;

  const ts = new TransformStream({
    start(e) {
      enqueue = e;
    },
    transform(chunk, done) {
      enqueue(chunk);
      done();
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
