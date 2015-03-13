const test = require('tape-catch');

import sequentialReadableStream from './utils/sequential-rs';
import duckTypedPassThroughTransform from './utils/duck-typed-pass-through-transform';
import readableStreamToArray from './utils/readable-stream-to-array';

test('Piping through a duck-typed pass-through transform stream works', t => {
  t.plan(1);

  const readableEnd = sequentialReadableStream(5).pipeThrough(duckTypedPassThroughTransform());

  readableStreamToArray(readableEnd).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});

test('Piping through an identity transform stream will close the destination when the source closes', t => {
  t.plan(1);

  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      close();
    }
  });

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  const ws = new WritableStream();

  rs.pipeThrough(ts).pipeTo(ws).finished.then(() => {
    t.equal(ws.state, 'closed', 'the writable stream was closed');
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
    start(enqueue, close) {
      setTimeout(() => enqueueReturnValues.push(enqueue('a')), 10);
      setTimeout(() => enqueueReturnValues.push(enqueue('b')), 30);
      setTimeout(() => enqueueReturnValues.push(enqueue('c')), 50);
      setTimeout(() => enqueueReturnValues.push(enqueue('d')), 70);
      setTimeout(() => enqueueReturnValues.push(enqueue('e')), 90);
      setTimeout(() => enqueueReturnValues.push(enqueue('f')), 110);
      setTimeout(() => enqueueReturnValues.push(enqueue('g')), 130);
      setTimeout(() => enqueueReturnValues.push(enqueue('h')), 150);
      setTimeout(() => close(), 170);
    }
  });

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
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
    rs.pipeThrough(ts).pipeTo(ws).finished.then(() => {
      t.deepEqual(
        enqueueReturnValues,
        [true, true, true, true, false, false, false, false],
        'backpressure was correctly exerted at the source');
      t.deepEqual(writtenValues, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], 'all chunks were written');
    });
  }, 0);
});
