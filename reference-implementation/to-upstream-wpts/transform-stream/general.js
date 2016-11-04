'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/rs-utils.js');
}

test(() => {
  new TransformStream({ transform() { } });
}, 'TransformStream can be constructed with a transform function');

test(() => {
  new TransformStream();
  new TransformStream({});
}, 'TransformStream can be constructed with no transform function');

test(() => {
  const ts = new TransformStream({ transform() { } });
  const proto = Object.getPrototypeOf(ts);

  const writableStream = Object.getOwnPropertyDescriptor(proto, 'writable');
  assert_true(writableStream !== undefined, 'it has a writable property');
  assert_false(writableStream.enumerable, 'writable should be non-enumerable');
  assert_equals(typeof writableStream.get, 'function', 'writable should have a getter');
  assert_equals(writableStream.set, undefined, 'writable should not have a setter');
  assert_true(writableStream.configurable, 'writable should be configurable');
  assert_true(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');

  const readableStream = Object.getOwnPropertyDescriptor(proto, 'readable');
  assert_true(readableStream !== undefined, 'it has a readable property');
  assert_false(readableStream.enumerable, 'readable should be non-enumerable');
  assert_equals(typeof readableStream.get, 'function', 'readable should have a getter');
  assert_equals(readableStream.set, undefined, 'readable should not have a setter');
  assert_true(readableStream.configurable, 'readable should be configurable');
  assert_true(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');
}, 'TransformStream instances must have writable and readable properties of the correct types');

test(() => {
  const ts = new TransformStream({ transform() { } });

  const writer = ts.writable.getWriter();
  assert_equals(writer.desiredSize, 1, 'writer.desiredSize should be 1');
}, 'TransformStream writable starts in the writable state');


promise_test(() => {
  const ts = new TransformStream();

  const writer = ts.writable.getWriter();
  writer.write('a');
  assert_equals(writer.desiredSize, 0, 'writer.desiredSize should be 0 after write()');

  return ts.readable.getReader().read().then(result => {
    assert_equals(result.value, 'a',
      'result from reading the readable is the same as was written to writable');
    assert_false(result.done, 'stream should not be done');

    return writer.ready.then(() => {
      assert_equals(writer.desiredSize, 1, 'desiredSize should be 1 again');
    });
  });
}, 'Identity TransformStream: can read from readable what is put into writable');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk) {
      c.enqueue(chunk.toUpperCase());
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  return ts.readable.getReader().read().then(result => {
    assert_equals(result.value, 'A',
      'result from reading the readable is the transformation of what was written to writable');
    assert_false(result.done, 'stream should not be done');
  });
}, 'Uppercaser sync TransformStream: can read from readable transformed version of what is put into writable');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk) {
      c.enqueue(chunk.toUpperCase());
      c.enqueue(chunk.toUpperCase());
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  const reader = ts.readable.getReader();

  return reader.read().then(result1 => {
    assert_equals(result1.value, 'A',
      'the first chunk read is the transformation of the single chunk written');
    assert_false(result1.done, 'stream should not be done');

    return reader.read().then(result2 => {
      assert_equals(result2.value, 'A',
        'the second chunk read is also the transformation of the single chunk written');
      assert_false(result2.done, 'stream should not be done');
    });
  });
}, 'Uppercaser-doubler sync TransformStream: can read both chunks put into the readable');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      return delay(50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');

  return ts.readable.getReader().read().then(result => {
    assert_equals(result.value, 'A',
      'result from reading the readable is the transformation of what was written to writable');
    assert_false(result.done, 'stream should not be done');
  });
}, 'Uppercaser async TransformStream: can read from readable transformed version of what is put into writable');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform(chunk) {
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 10);
      setTimeout(() => c.enqueue(chunk.toUpperCase()), 50);
      return delay(90);
    }
  });

  const reader = ts.readable.getReader();

  const writer = ts.writable.getWriter();
  writer.write('a');

  return reader.read().then(result1 => {
    assert_equals(result1.value, 'A',
      'the first chunk read is the transformation of the single chunk written');
    assert_false(result1.done, 'stream should not be done');

    return reader.read().then(result2 => {
      assert_equals(result2.value, 'A',
        'the second chunk read is also the transformation of the single chunk written');
      assert_false(result2.done, 'stream should not be done');
    });
  });
}, 'Uppercaser-doubler async TransformStream: can read both chunks put into the readable');

promise_test(() => {
  const ts = new TransformStream({ transform() { } });

  const writer = ts.writable.getWriter();
  writer.close();

  return Promise.all([writer.closed, ts.readable.getReader().closed]);
}, 'TransformStream: by default, closing the writable closes the readable (when there are no queued writes)');

promise_test(() => {
  const ts = new TransformStream({
    transform() {
      return delay(50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  let rsClosed = false;
  ts.readable.getReader().closed.then(() => {
    rsClosed = true;
  });

  return delay(0).then(() => {
    assert_equals(rsClosed, false, 'readable is not closed after a tick');

    return writer.closed.then(() => {
      // TODO: Is this expectation correct?
      assert_equals(rsClosed, true, 'readable is closed at that point');
    });
  });
}, 'TransformStream: by default, closing the writable waits for transforms to finish before closing both');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform() {
      c.enqueue('x');
      c.enqueue('y');
      return delay(50);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  const readableChunks = readableStreamToArray(ts.readable);

  return writer.closed.then(() => {
    return readableChunks.then(chunks => {
      assert_array_equals(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
    });
  });
}, 'TransformStream: by default, closing the writable closes the readable after sync enqueues and async done');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    start(controller) {
      c = controller;
    },
    transform() {
      setTimeout(() => c.enqueue('x'), 10);
      setTimeout(() => c.enqueue('y'), 50);
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  const readableChunks = readableStreamToArray(ts.readable);

  return writer.closed.then(() => {
    return readableChunks.then(chunks => {
      assert_array_equals(chunks, ['x', 'y'], 'both enqueued chunks can be read from the readable');
    });
  });
}, 'TransformStream: by default, closing the writable closes the readable after async enqueues and async done');

promise_test(() => {
  let c;
  const ts = new TransformStream({
    suffix: '-suffix',

    start(controller) {
      c = controller;
    },

    transform(chunk) {
      c.enqueue(chunk + this.suffix);
    },

    flush() {
      c.enqueue('flushed' + this.suffix);
    }
  });

  const writer = ts.writable.getWriter();
  writer.write('a');
  writer.close();

  const readableChunks = readableStreamToArray(ts.readable);

  return writer.closed.then(() => {
    return readableChunks.then(chunks => {
      assert_array_equals(chunks, ['a-suffix', 'flushed-suffix'], 'both enqueued chunks have suffixes');
    });
  });
}, 'Transform stream should call transformer methods as methods');

done();
