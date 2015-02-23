const test = require('tape-catch');

import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream can be constructed with no arguments', t => {
  t.doesNotThrow(() => new ReadableStream(), 'ReadableStream constructed with no errors');
  t.end();
});

// Traceur-troubles, skip for now
test.skip('ReadableStream has an EOS static property', t => {
  const props = Object.getOwnPropertyNames(ReadableStream);
  t.deepEqual(props, ['EOS']);

  const propDesc = Object.getOwnPropertyDescriptor(ReadableStream, 'EOS');
  t.equal(propDesc.enumerable, false);
  t.equal(propDesc.writable, false);
  t.equal(propDesc.configurable, false);
  t.equal(typeof propDesc.value, 'symbol');
  t.equal(String(propDesc.value), 'ReadableStream.EOS');

  t.end();
});

test('ReadableStream instances have the correct methods and properties', t => {
  const rs = new ReadableStream();

  t.equal(typeof rs.read, 'function', 'has a read method');
  t.equal(typeof rs.cancel, 'function', 'has a cancel method');
  t.equal(typeof rs.pipeTo, 'function', 'has a pipeTo method');
  t.equal(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');

  t.equal(rs.state, 'readable', 'state starts out readable');

  t.ok(rs.closed, 'has a closed property');
  t.ok(rs.closed.then, 'closed property is thenable');

  t.end();
});

test('ReadableStream: immediately closing should put the stream in a closed state and fulfill closed with undefined',
     t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.state, 'closed', 'The stream should be in closed state');

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should fulfill with undefined'),
    () => t.fail('closed should not reject')
  );
});

test('ReadableStream: leaving a stream empty leaves it in a readable state, causing read() to never settle', t => {
  const rs = new ReadableStream();
  t.equal(rs.state, 'readable');

  rs.read().then(
    () => t.fail('read() should not fulfill'),
    () => t.fail('read() should not reject')
  );

  setTimeout(() => t.end(), 100);
});

test('ReadableStream: reading a closed stream fulfills with EOS', t => {
  t.plan(1);

  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  rs.read().then(
    v => t.equal(v, ReadableStream.EOS, 'read() should return a promise fulfilled with EOS'),
    () => t.fail('read() should not return a rejected promise')
  );
});

test('ReadableStream: reading an errored stream rejects with the stored error', t => {
  t.plan(2);

  const passedError = new Error('aaaugh!!');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(passedError);
    }
  });

  t.equal(rs.state, 'errored');

  rs.read().then(
    () => t.fail('read() should not fulfill'),
    e => t.equal(e, passedError, 'read() should reject with the passed error')
  );
});

test('ReadableStream: reading a forever-empty stream while a read is still ongoing rejects', t => {
  t.plan(1);

  const rs = new ReadableStream();

  rs.read().then(
    () => t.fail('first read() should not fulfill'),
    e => t.fail('first read() should not reject')
  );

  rs.read().then(
    () => t.fail('second read() should not fulfill'),
    e => t.equal(e.constructor, TypeError, 'second read() should reject with a TypeError')
  );
});

test('ReadableStream: reading a nonempty stream while a read is still ongoing rejects', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      enqueue('b');
    }
  });

  rs.read().then(
    v => t.equal(v, 'a', 'first read() should fulfill with the first chunk'),
    e => t.fail('first read() should not reject')
  );

  rs.read().then(
    () => t.fail('second read() should not fulfill'),
    e => t.equal(e.constructor, TypeError, 'second read() should reject with a TypeError')
  );
});

test('ReadableStream: reading a nonempty stream with appropriate waiting works fine', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      enqueue('b');
    }
  });

  rs.read()
    .then(
      v => {
        t.equal(v, 'a', 'first read() should fulfill with the first chunk');
        return rs.read();
      },
      e => t.fail('first read() should not reject')
    )
    .then(
      v => t.equal(v, 'b', 'second read() should fulfill with the second chunk'),
      e => t.fail('second read() should not reject')
    );
});

test('ReadableStream: reading a nonempty stream to the end works fine', t => {
  t.plan(3);

  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      close();
    }
  });

  rs.read()
    .then(
      v => {
        t.equal(v, 'a', 'first read() should fulfill with the first chunk');
        return rs.read();
      },
      e => t.fail('first read() should not reject')
    )
    .then(
      v => {
        t.equal(v, 'b', 'second read() should fulfill with the second chunk');
        return rs.read();
      },
      e => t.fail('second read() should not reject') || t.error(e)
    )
    .then(
      v => t.equal(v, ReadableStream.EOS, 'third read() should fulfill with EOS'),
      e => t.fail('third read() should not reject')
    );
});

test('ReadableStream: draining a stream via read() causes the closed promise to fulfill', t => {
  t.plan(5);

  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('test');
      close();
    }
  });

  t.equal(rs.state, 'readable', 'The stream should be in readable state to start with');

  rs.read().then(
    v => {
      t.equal(v, 'test', 'the enqueued chunk should be read');
      t.equal(rs.state, 'closed', 'the stream should still be in a closed state');
    },
    e => t.fail('read() should not reject')
  );

  t.equal(rs.state, 'closed', 'The stream should be in a closed state immediately after reading');

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should fulfill with undefined'),
    () => t.fail('closed should not reject')
  );
});

test('ReadableStream: should only call underlying source pull() once upon starting the stream', t => {
  t.plan(2);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull() {
      pullCount++;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');
  });

  setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
});

test('ReadableStream: should only call underlying source pull() once on a forever-empty stream, even after reading',
     t => {
  t.plan(2);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull() {
      pullCount++;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');
  });

  rs.read();

  setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
});

test('ReadableStream: should only call underlying source pull() once on a non-empty stream read from before start ' +
     'fulfills', t => {
  t.plan(5);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      return startPromise;
    },
    pull() {
      pullCount++;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');
  });

  rs.read().then(v => {
    t.equal(v, 'a', 'first read() should return first chunk');
    t.equal(pullCount, 1, 'pull should not have been called again');
  });

  t.equal(pullCount, 0, 'calling read() should not cause pull to be called yet');

  setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
});

test('ReadableStream: should only call underlying source pull() twice on a non-empty stream read from after start ' +
     'fulfills', t => {
  t.plan(5);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      return startPromise;
    },
    pull() {
      pullCount++;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');

    rs.read().then(v => {
      t.equal(v, 'a', 'first read() should return first chunk');
      t.equal(pullCount, 2, 'pull should be called again once read fulfills');
    });
  });

  t.equal(pullCount, 0, 'calling read() should not cause pull to be called yet');

  setTimeout(() => t.equal(pullCount, 2, 'pull should be called exactly twice'), 50);
});

test('ReadableStream: should call underlying source pull() in reaction to read()ing the last chunk', t => {
  t.plan(6);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull(enqueue) {
      enqueue(++pullCount);
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');

    return rs.read();
  })
  .then(v => {
    t.equal(v, 1, 'first read() should return first chunk');
    t.equal(pullCount, 2, 'pull should be called in reaction to reading');
    return rs.read();
  })
  .then(v => {
    t.equal(v, 2, 'second read() should return second chunk');
    t.equal(pullCount, 3, 'pull should be called in reaction to reading, again');
  });

  setTimeout(() => t.equal(pullCount, 3, 'pull should be called exactly thrice'), 50);
});

test('ReadableStream: if start throws an error, it should be re-thrown', t => {
  t.plan(1);

  const error = new Error('aaaugh!!');

  try {
    new ReadableStream({ start() { throw error; } });
    t.fail('Constructor didn\'t throw');
  } catch (caughtError) {
    t.equal(caughtError, error, 'error was allowed to propagate');
  }
});

test('ReadableStream: if pull throws an error, it should error the stream', t => {
  t.plan(5);

  const error = new Error('aaaugh!!');
  const rs = new ReadableStream({
    pull() {
      throw error;
    }
  });

  t.equal(rs.state, 'readable', 'state should start out "readable" since pull isn\'t called immediately');

  rs.closed.catch(e => {
    t.equal(rs.state, 'errored', 'state should be "errored" in closed catch');
    t.equal(e, error, 'closed should reject with the thrown error');
  });

  rs.read().catch(e => {
    t.equal(rs.state, 'errored', 'state should be "errored" in read() catch');
    t.equal(e, error, 'read() should reject with the thrown error');
  });
});

test('ReadableStream: if pull rejects, it should error the stream', t => {
  t.plan(5);

  const error = new Error('pull failure');
  const rs = new ReadableStream({
    pull() {
      return Promise.reject(error);
    }
  });

  t.equal(rs.state, 'readable', 'state should start out "readable" since pull isn\'t called immediately');

  rs.closed.catch(e => {
    t.equal(rs.state, 'errored', 'state should be "errored" in closed catch');
    t.equal(e, error, 'closed should reject with the thrown error');
  });

  rs.read().catch(e => {
    t.equal(rs.state, 'errored', 'state should be "errored" in read() catch');
    t.equal(e, error, 'read() should reject with the thrown error');
  });
});

test('ReadableStream integration test: adapting a random push source', t => {
  let pullChecked = false;
  const randomSource = new RandomPushSource(8);

  const rs = new ReadableStream({
    start(enqueue, close, error) {
      t.equal(typeof enqueue,  'function', 'enqueue should be a function in start');
      t.equal(typeof close, 'function', 'close should be a function in start');
      t.equal(typeof error, 'function', 'error should be a function in start');

      randomSource.ondata = chunk => {
        if (!enqueue(chunk)) {
          randomSource.readStop();
        }
      };

      randomSource.onend = close;
      randomSource.onerror = error;
    },

    pull(enqueue, close) {
      if (!pullChecked) {
        pullChecked = true;
        t.equal(typeof enqueue, 'function', 'enqueue should be a function in pull');
        t.equal(typeof close, 'function', 'close should be a function in pull');
      }

      randomSource.readStart();
    }
  });

  readableStreamToArray(rs).then(
    chunks => {
      t.equal(rs.state, 'closed', 'stream should be closed after all chunks are read');
      t.equal(chunks.length, 8, '8 chunks should be read');
      for (let i = 0; i < chunks.length; i++) {
        t.equal(chunks[i].length, 128, `chunk ${i + 1} should have 128 bytes`);
      }

      t.end();
    },
    e => t.error(e)
  );
});

test('ReadableStream integration test: adapting a sync pull source', t => {
  const rs = sequentialReadableStream(10);

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed after all chunks are read');
    t.equal(rs.source.closed, true, 'source should be closed after all chunks are read');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');

    t.end();
  });
});

test('ReadableStream integration test: adapting an async pull source', t => {
  const rs = sequentialReadableStream(10, { async: true });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed after all chunks are read');
    t.equal(rs.source.closed, true, 'source should be closed after all chunks are read');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');

    t.end();
  });
});

test('ReadableStream: should not call pull until the previous pull call\'s promise fulfills', t => {
  let resolve;
  let returnedPromise;
  let timesCalled = 0;
  const rs = new ReadableStream({
    pull(enqueue) {
      ++timesCalled;
      enqueue(timesCalled);
      returnedPromise = new Promise(r => { resolve = r; });
      return returnedPromise;
    }
  });

  rs.read().then(chunk1 => {
    t.equal(timesCalled, 1, 'pull should not yet have been called a second time');
    t.equal(chunk1, 1, 'read() should fulfill with the enqueued value');

    setTimeout(() => {
      t.equal(timesCalled, 1, 'after 30 ms, pull should still only have been called once');

      resolve();

      returnedPromise.then(() => {
        t.equal(timesCalled, 2, 'after the promise returned by pull is fulfilled, pull should be called a second time');
        t.end();
      });
    }, 30);
  });
});

test('ReadableStream: should pull after start, and after every read', t => {
  let timesCalled = 0;

  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      return startPromise;
    },
    pull() {
      ++timesCalled;
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        return false;
      }
    }
  });

  // Wait for start to finish
  startPromise.then(() => {
    return rs.read().then(chunk1 => {
      t.equal(chunk1, 'a', 'first chunk should be as expected');

      return rs.read().then(chunk2 => {
        t.equal(chunk2, 'b', 'second chunk should be as expected');

        return rs.read().then(chunk3 => {
          t.equal(chunk3, 'c', 'third chunk should be as expected');

          setTimeout(() => {
            // Once for after start, and once for every read.
            t.equal(timesCalled, 4, 'pull() should be called exactly four times');
            t.end();
          }, 50);
        });
      });
    });
  })
  .catch(e => t.error(e));
});

test('ReadableStream strategies: the default strategy should return false for all but the first enqueue call', t => {
  t.plan(5);

  new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('a'), true, 'first enqueue should return true');
      t.equal(enqueue('b'), false, 'second enqueue should return false');
      t.equal(enqueue('c'), false, 'third enqueue should return false');
      t.equal(enqueue('d'), false, 'fourth enqueue should return false');
      t.equal(enqueue('e'), false, 'fifth enqueue should return false');
    }
  });
});

test('ReadableStream strategies: the default strategy should continue returning true from enqueue if the chunks are ' +
     'read immediately', t => {
  let doEnqueue;
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
    }
  });

  t.equal(doEnqueue('a'), true, 'first enqueue should return true');

  rs.read().then(chunk1 => {
    t.equal(chunk1, 'a', 'first chunk read should be correct');
    t.equal(doEnqueue('b'), true, 'second enqueue should return true');

    return rs.read().then(chunk2 => {
      t.equal(chunk2, 'b', 'second chunk read should be correct');
      t.equal(doEnqueue('c'), true, 'third enqueue should return true');

      return rs.read().then(chunk3 => {
        t.equal(chunk3, 'c', 'third chunk read should be correct');
        t.equal(doEnqueue('d'), true, 'fourth enqueue should return true');

        t.end();
      });
    });
  })
  .catch(e => t.error(e));
});

test('ReadableStream: enqueue should throw when the stream is readable but draining', t => {
  t.plan(4);

  const rs = new ReadableStream({
    start(enqueue, close) {
      t.equal(enqueue('a'), true, 'the first enqueue should return true');
      close();

      t.throws(
        () => enqueue('b'),
        /TypeError/,
        'enqueue after close should throw a TypeError'
      );
    }
  });

  t.equal(rs.state, 'readable', 'state should start readable');
  rs.read();
  t.equal(rs.state, 'closed', 'state should become closed immediately after reading');
});

test('ReadableStream: enqueue should throw when the stream is closed', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue, close) {
      close();

      t.throws(
        () => enqueue('a'),
        /TypeError/,
        'enqueue after close should throw a TypeError'
      );
    }
  });

  t.equal(rs.state, 'closed', 'state should be closed immediately after creation');
});

test('ReadableStream: enqueue should throw the stored error when the stream is errored', t => {
  t.plan(2);

  const expectedError = new Error('i am sad');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(expectedError);

      t.throws(
        () => enqueue('a'),
        /i am sad/,
        'enqueue after error should throw that error'
      );
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored immediately after creation');
});

test('ReadableStream: cancel() and closed on a closed stream should return the same promise', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.cancel(), rs.closed, 'the promises returned should be the same');
  t.end();
});

test('ReadableStream: cancel() and closed on an errored stream should return the same promise', t => {
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(new Error('boo!'));
    }
  });

  t.equal(rs.cancel(), rs.closed, 'the promises returned should be the same');
  t.end();
});

test('ReadableStream: read() returns fresh promises each call (empty stream)', t => {
  const rs = new ReadableStream();
  t.notEqual(rs.read(), rs.read(), 'the promises returned should be different');
  t.end();
});

test('ReadableStream: read() returns fresh promises each call (stream with a chunk)', t => {
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
    }
  });

  t.notEqual(rs.read(), rs.read(), 'the promises returned should be different');
  t.end();
});

test('ReadableStream: should call underlying source methods as methods', t => {
  t.plan(6);

  class Source {
    start(enqueue) {
      t.equal(this, theSource, 'start() should be called with the correct this');
      enqueue('a');
    }

    pull() {
      t.equal(this, theSource, 'pull() should be called with the correct this');
    }

    cancel() {
      t.equal(this, theSource, 'cancel() should be called with the correct this');
    }

    get strategy() {
      // Called three times
      t.equal(this, theSource, 'strategy getter should be called with the correct this');
      return undefined;
    }
  }

  const theSource = new Source();
  theSource.debugName = 'the source object passed to the constructor'; // makes test failures easier to diagnose
  const rs = new ReadableStream(theSource);

  rs.read().then(() => rs.cancel());
});
