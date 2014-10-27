var test = require('tape');

import sequentialReadableStream from './utils/sequential-rs';
import duckTypedPassThroughTransform from './utils/duck-typed-pass-through-transform';
import readableStreamToArray from './utils/readable-stream-to-array';
import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import TransformStream from '../lib/transform-stream';

test('Piping through a duck-typed pass-through transform stream works', t => {
  t.plan(1);

  var readableEnd = sequentialReadableStream(5).pipeThrough(duckTypedPassThroughTransform());

  readableStreamToArray(readableEnd).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});

test('Piping through an identity transform stream will close the destination when the source closes', t => {
  t.plan(2);

  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      close();
    }
  });

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  var ws = new WritableStream();

  rs.pipeThrough(ts).pipeTo(ws).then(() => {
    t.equal(rs.state, 'closed', 'the readable stream was closed');
    t.equal(ws.state, 'closed', 'the writable stream was closed');
  });
});

// FIXME: expected results here will probably change as we fix https://github.com/whatwg/streams/issues/190
// As they are now they don't make very much sense, so we will skip the test. When #190 is fixed, we should fix the
// test and re-enable.
test.skip('Piping through a default transform stream causes backpressure to be exerted after some delay', t => {
  t.plan(2);

  // Producer: every 20 ms
  var enqueueReturnValues = [];
  var rs = new ReadableStream({
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

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      enqueue(chunk);
      done();
    }
  });

  // Consumer: every 90 ms
  var writtenValues = [];
  var ws = new WritableStream({
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
