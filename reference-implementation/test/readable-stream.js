const test = require('tape-catch');

import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream can be constructed with no arguments', t => {
  t.doesNotThrow(() => new ReadableStream(), 'ReadableStream constructed with no errors');
  t.end();
});

test('ReadableStream: if start throws an error, it should be re-thrown', t => {
  t.plan(1);

  const error = new Error('aaaugh!!');

  t.throws(() => new ReadableStream({ start() { throw error; } }), /aaaugh/, 'error should be re-thrown');
});

test('ReadableStream: if pull rejects, it should error the stream', t => {
  t.plan(2);

  const error = new Error('pull failure');
  const rs = new ReadableStream({
    pull() {
      return Promise.reject(error);
    }
  });

  rs.closed.catch(e => {
    t.equal(e, error, 'closed should reject with the thrown error');
  });

  rs.getReader().read().catch(e => {
    t.equal(e, error, 'read() should reject with the thrown error');
  });
});

test('ReadableStream: calling close twice should be a no-op', t => {
  t.plan(2);

  new ReadableStream({
    start(enqueue, close) {
      close();
      t.doesNotThrow(close);
    }
  })
  .closed.then(() => t.pass('closed should fulfill'));
});

test('ReadableStream: calling error twice should be a no-op', t => {
  t.plan(2);

  const theError = new Error('boo!');
  const error2 = new Error('not me!');
  new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
      t.doesNotThrow(() => error(error2));
    }
  })
  .closed.catch(e => t.equal(e, theError, 'closed should reject with the first error'));
});

test('ReadableStream: calling error after close should be a no-op', t => {
  t.plan(2);

  new ReadableStream({
    start(enqueue, close, error) {
      close();
      t.doesNotThrow(error);
    }
  })
  .closed.then(() => t.pass('closed should fulfill'));
});

test('ReadableStream: calling close after error should be a no-op', t => {
  t.plan(2);

  const theError = new Error('boo!');
  new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
      t.doesNotThrow(close);
    }
  })
  .closed.catch(e => t.equal(e, theError, 'closed should reject with the first error'));
});

test('ReadableStream: should only call pull once upon starting the stream', t => {
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

test('ReadableStream: should only call pull once for a forever-empty stream, even after reading', t => {
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

  rs.getReader().read();

  setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
});

test('ReadableStream: should only call pull once on a non-empty stream read from before start fulfills', t => {
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

  rs.getReader().read().then(r => {
    t.deepEqual(r, { value: 'a', done: false }, 'first read() should return first chunk');
    t.equal(pullCount, 1, 'pull should not have been called again');
  });

  t.equal(pullCount, 0, 'calling read() should not cause pull to be called yet');

  setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
});

test('ReadableStream: should only call pull twice on a non-empty stream read from after start fulfills', t => {
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

    rs.getReader().read().then(r => {
      t.deepEqual(r, { value: 'a', done: false }, 'first read() should return first chunk');
      t.equal(pullCount, 2, 'pull should be called again once read fulfills');
    });
  });

  t.equal(pullCount, 0, 'calling read() should not cause pull to be called yet');

  setTimeout(() => t.equal(pullCount, 2, 'pull should be called exactly twice'), 50);
});

test('ReadableStream: should call pull in reaction to read()ing the last chunk, if not draining', t => {
  t.plan(4);

  let pullCount = 0;
  let doEnqueue;
  const startPromise = Promise.resolve();
  const pullPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue) {
      doEnqueue = enqueue;
      return startPromise;
    },
    pull() {
      ++pullCount;
      return pullPromise;
    }
  });

  const reader = rs.getReader();

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should have been called once after read');

    doEnqueue('a');

    return pullPromise.then(() => {
      t.equal(pullCount, 2, 'pull should have been called a second time after enqueue');

      return reader.read().then(() => {
        t.equal(pullCount, 3, 'pull should have been called a third time after read');
      });
    });
  })
  .catch(e => t.error(e));

  setTimeout(() => t.equal(pullCount, 3, 'pull should be called exactly thrice'), 50);
});

test('ReadableStream: should not call pull() in reaction to read()ing the last chunk, if draining', t => {
  t.plan(4);

  let pullCount = 0;
  let doEnqueue;
  let doClose;
  const startPromise = Promise.resolve();
  const pullPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue, close) {
      doEnqueue = enqueue;
      doClose = close;
      return startPromise;
    },
    pull() {
      ++pullCount;
      return pullPromise;
    }
  });

  const reader = rs.getReader();

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should have been called once after read');

    doEnqueue('a');

    return pullPromise.then(() => {
      t.equal(pullCount, 2, 'pull should have been called a second time after enqueue');

      doClose();

      return reader.read().then(() => {
        t.equal(pullCount, 2, 'pull should not have been called a third time after read');
      });
    });
  })
  .catch(e => t.error(e));

  setTimeout(() => t.equal(pullCount, 2, 'pull should be called exactly twice'), 50);
});

test('ReadableStream: should not call pull until the previous pull call\'s promise fulfills', t => {
  let resolve;
  let returnedPromise;
  let timesCalled = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      return startPromise;
    },
    pull(enqueue) {
      ++timesCalled;
      returnedPromise = new Promise(r => { resolve = r; });
      return returnedPromise;
    }
  });
  const reader = rs.getReader();

  startPromise.then(() =>
    reader.read().then(result1 => {
      t.equal(timesCalled, 1,
        'pull should have been called once after start, but not yet have been called a second time');
      t.deepEqual(result1, { value: 'a', done: false }, 'read() should fulfill with the enqueued value');

      setTimeout(() => {
        t.equal(timesCalled, 1, 'after 30 ms, pull should still only have been called once');

        resolve();

        returnedPromise.then(() => {
          t.equal(timesCalled, 2,
            'after the promise returned by pull is fulfilled, pull should be called a second time');
          t.end();
        });
      }, 30);
    })
  )
  .catch(e => t.error(e));
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
  const reader = rs.getReader();

  startPromise.then(() => {
    return reader.read().then(result1 => {
      t.deepEqual(result1, { value: 'a', done: false }, 'first chunk should be as expected');

      return reader.read().then(result2 => {
        t.deepEqual(result2, { value: 'b', done: false }, 'second chunk should be as expected');

        return reader.read().then(result3 => {
          t.deepEqual(result3, { value: 'c', done: false }, 'third chunk should be as expected');

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

test('ReadableStream: should not call pull after start if the stream is now closed', t => {
  let timesCalled = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      close();
      return startPromise;
    },
    pull() {
      ++timesCalled;
    }
  });

  startPromise.then(() => {
    t.equal(timesCalled, 0, 'after start finishes, pull should not have been called');

    const reader = rs.getReader();
    return reader.read().then(() => {
      t.equal(timesCalled, 0, 'reading should not have triggered a pull call');

      return rs.closed.then(() => {
        t.equal(timesCalled, 0, 'stream should have closed with still no calls to pull');
        t.end();
      });
    });
  })
  .catch(e => t.error(e));
});

test('ReadableStream: should call pull after enqueueing from inside pull (with no read requests), if strategy allows',
     t => {
  let timesCalled = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull(enqueue) {
      enqueue(++timesCalled);
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure(size) {
        return size > 3;
      }
    }
  });

  startPromise.then(() => {
    // after start: size = 0, pull()
    // after enqueue(1): size = 1, pull()
    // after enqueue(2): size = 2, pull()
    // after enqueue(3): size = 3, pull()
    // after enqueue(4): size = 4, do not pull
    t.equal(timesCalled, 4, 'pull() should have been called four times');
    t.end();
  });
});

test('ReadableStream: enqueue should throw when the stream is readable but draining', t => {
  t.plan(2);

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
});

test('ReadableStream: enqueue should throw when the stream is closed', t => {
  t.plan(1);

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
});

test('ReadableStream: enqueue should throw the stored error when the stream is errored', t => {
  t.plan(1);

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

  rs.getReader().read().then(() => rs.cancel());
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
  const reader = rs.getReader();

  t.equal(doEnqueue('a'), true, 'first enqueue should return true');

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'a', done: false }, 'first chunk read should be correct');
    t.equal(doEnqueue('b'), true, 'second enqueue should return true');

    return reader.read();
  })
  .then(result2 => {
    t.deepEqual(result2, { value: 'b', done: false }, 'second chunk read should be correct');
    t.equal(doEnqueue('c'), true, 'third enqueue should return true');

    return reader.read();
  })
  .then(result3 => {
    t.deepEqual(result3, { value: 'c', done: false }, 'third chunk read should be correct');
    t.equal(doEnqueue('d'), true, 'fourth enqueue should return true');

    t.end();
  })
  .catch(e => t.error(e));
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
    t.equal(rs.source.closed, true, 'source should be closed after all chunks are read');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');

    t.end();
  });
});

test('ReadableStream integration test: adapting an async pull source', t => {
  const rs = sequentialReadableStream(10, { async: true });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.source.closed, true, 'source should be closed after all chunks are read');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');

    t.end();
  });
});
