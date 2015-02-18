const test = require('tape-catch');

import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream can be constructed with no arguments', t => {
  t.plan(1);
  t.doesNotThrow(() => new ReadableStream(), 'ReadableStream constructed with no errors');
});

test('ReadableStream instances have the correct methods and properties', t => {
  t.plan(9);

  const rs = new ReadableStream();

  t.equal(typeof rs.read, 'function', 'has a read method');
  t.equal(typeof rs.cancel, 'function', 'has a cancel method');
  t.equal(typeof rs.pipeTo, 'function', 'has a pipeTo method');
  t.equal(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');

  t.equal(rs.state, 'waiting', 'state starts out waiting');

  t.ok(rs.ready, 'has a ready property');
  t.ok(rs.ready.then, 'ready property is a thenable');
  t.ok(rs.closed, 'has a closed property');
  t.ok(rs.closed.then, 'closed property is thenable');
});

test('ReadableStream closing puts the stream in a closed state, fulfilling the ready and closed promises with ' +
    'undefined', t => {
  t.plan(3);

  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.state, 'closed', 'The stream should be in closed state');

  rs.ready.then(
    v => t.equal(v, undefined, 'ready should return a promise fulfilled with undefined'),
    () => t.fail('ready should not return a rejected promise')
  );

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should return a promise fulfilled with undefined'),
    () => t.fail('closed should not return a rejected promise')
  );
});

test('ReadableStream reading a waiting stream throws a TypeError', t => {
  t.plan(2);

  const rs = new ReadableStream();

  t.equal(rs.state, 'waiting');
  t.throws(() => rs.read(), /TypeError/);
});

test('ReadableStream reading a closed stream throws a TypeError', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.state, 'closed');
  t.throws(() => rs.read(), /TypeError/);
});

test('ReadableStream reading an errored stream throws the stored error', t => {
  t.plan(2);

  const passedError = new Error('aaaugh!!');

  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(passedError);
    }
  });

  t.equal(rs.state, 'errored');
  try {
    rs.read();
    t.fail('rs.read() didn\'t throw');
  } catch (e) {
    t.equal(e, passedError);
  }
});

test('ReadableStream reading a stream makes ready and closed return a promise fulfilled with undefined when the ' +
    'stream is fully drained', t => {
  t.plan(6);

  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('test');
      close();
    }
  });

  t.equal(rs.state, 'readable', 'The stream should be in readable state');
  t.equal(rs.read(), 'test', 'A test string should be read');
  t.equal(rs.state, 'closed', 'The stream should be in closed state');

  t.throws(() => rs.read(), /TypeError/);

  rs.ready.then(
    v => t.equal(v, undefined, 'ready should return a promise fulfilled with undefined'),
    () => t.fail('ready should not return a rejected promise')
  );

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should return a promise fulfilled with undefined'),
    () => t.fail('closed should not return a rejected promise')
  );
});

test('ReadableStream avoid redundant pull call', t => {
  let pullCount = 0;
  const rs = new ReadableStream({
    pull() {
      pullCount++;
    },

    cancel() {
      t.fail('cancel should not be called');
    }
  });

  rs.ready;
  rs.ready;
  rs.ready;

  // Use setTimeout to ensure we run after any promises.
  setTimeout(() => {
    t.equal(pullCount, 1, 'pull should not be called more than once');
    t.end();
  }, 50);
});

test('ReadableStream start throws an error', t => {
  t.plan(1);

  const error = new Error('aaaugh!!');

  try {
    new ReadableStream({ start() { throw error; } });
    t.fail('Constructor didn\'t throw');
  } catch (caughtError) {
    t.equal(caughtError, error, 'error was allowed to propagate');
  }
});

test('ReadableStream pull throws an error', t => {
  t.plan(4);

  const error = new Error('aaaugh!!');
  const rs = new ReadableStream({ pull() { throw error; } });

  rs.closed.then(() => {
    t.fail('the stream should not close successfully');
    t.end();
  });

  rs.ready.then(v => {
    t.equal(rs.state, 'errored', 'state is "errored" after waiting'),
    t.equal(v, undefined, 'ready fulfills with undefined')
  });

  rs.closed.catch(caught => {
    t.equal(rs.state, 'errored', 'state is "errored" in closed catch');
    t.equal(caught, error, 'error was passed through as rejection reason of closed property');
  });
});

test('ReadableStream adapting a push source', t => {
  let pullChecked = false;
  const randomSource = new RandomPushSource(8);

  const rs = new ReadableStream({
    start(enqueue, close, error) {
      t.equal(typeof enqueue,  'function', 'enqueue is a function in start');
      t.equal(typeof close, 'function', 'close is a function in start');
      t.equal(typeof error, 'function', 'error is a function in start');

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
        t.equal(typeof enqueue, 'function', 'enqueue is a function in pull');
        t.equal(typeof close, 'function', 'close is a function in pull');
      }

      randomSource.readStart();
    }
  });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'should be closed');
    t.equal(chunks.length, 8, 'got the expected 8 chunks');
    for (let i = 0; i < chunks.length; i++) {
      t.equal(chunks[i].length, 128, 'each chunk has 128 bytes');
    }

    t.end();
  });
});

test('ReadableStream adapting a sync pull source', t => {
  const rs = sequentialReadableStream(10);

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed');
    t.equal(rs.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream adapting an async pull source', t => {
  const rs = sequentialReadableStream(10, { async: true });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed');
    t.equal(rs.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream is able to enqueue lots of data in a single pull, making it available synchronously', t => {
  let i = 0;
  const rs = new ReadableStream({
    pull(enqueue, close) {
      while (++i <= 10) {
        enqueue(i);
      }

      close();
    }
  });

  rs.ready.then(() => {
    const data = [];
    while (rs.state === 'readable') {
      data.push(rs.read());
    }

    t.deepEqual(data, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    t.end();
  });
});

test('ReadableStream does not call pull until previous pull\'s promise fulfills', t => {
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

  t.equal(rs.state, 'waiting', 'stream starts out waiting');

  rs.ready.then(() => {
    t.equal(rs.state, 'readable', 'stream becomes readable (even before promise fulfills)');
    t.equal(timesCalled, 1, 'pull is not yet called a second time');
    t.equal(rs.read(), 1, 'read() returns enqueued value');

    setTimeout(() => {
      t.equal(timesCalled, 1, 'after 30 ms, pull has still only been called once');

      resolve();

      returnedPromise.then(() => {
        t.equal(timesCalled, 2, 'after the promise is fulfilled, pull is called a second time');
        t.equal(rs.read(), 2, 'read() returns the second enqueued value');
        t.end();
      });
    }, 30);
  });
});

test('ReadableStream does not call pull multiple times after previous pull finishes', t => {
  let timesCalled = 0;

  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
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

  t.equal(rs.state, 'readable', 'since start() synchronously enqueued chunks, the stream is readable');

  // Wait for start to finish
  rs.ready.then(() => {
    t.equal(rs.read(), 'a', 'first chunk should be as expected');
    t.equal(rs.read(), 'b', 'second chunk should be as expected');
    t.equal(rs.read(), 'c', 'third chunk should be as expected');

    setTimeout(() => {
      // Once for after start, and once for after rs.read() === 'a'.
      t.equal(timesCalled, 2, 'pull() should only be called twice');
      t.end();
    }, 50);
  });
});

test('ReadableStream pull rejection makes stream errored', t => {
  t.plan(2);

  const theError = new Error('pull failure');
  const rs = new ReadableStream({
    pull() {
      return Promise.reject(theError);
    }
  });

  t.equal(rs.state, 'waiting', 'stream starts out waiting');

  rs.closed.then(
    () => t.fail('.closed should not fulfill'),
    e => t.equal(e, theError, '.closed should reject with the error')
  );
});

test('ReadableStream ready does not error when no more data is available', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  const rs = sequentialReadableStream(5, { async: true });
  const result = [];

  pump();

  function pump() {
    while (rs.state === 'readable') {
      result.push(rs.read());
    }

    if (rs.state === 'closed') {
      t.deepEqual(result, [1, 2, 3, 4, 5], 'got the expected 5 chunks');
    } else {
      rs.ready.then(pump, r => t.ifError(r));
    }
  }
});

test('ReadableStream should be able to get data sequentially from an asynchronous stream', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(4);

  const rs = sequentialReadableStream(3, { async: true });

  const result = [];
  const EOF = Object.create(null);

  getNext().then(v => {
    t.equal(v, 1, 'first chunk should be 1');
    return getNext().then(v => {
      t.equal(v, 2, 'second chunk should be 2');
      return getNext().then(v => {
        t.equal(v, 3, 'third chunk should be 3');
        return getNext().then(v => {
          t.equal(v, EOF, 'fourth result should be EOF');
        });
      });
    });
  })
  .catch(r => t.ifError(r));

  function getNext() {
    if (rs.state === 'closed') {
      return Promise.resolve(EOF);
    }

    return rs.ready.then(() => {
      if (rs.state === 'readable') {
        return rs.read();
      } else if (rs.state === 'closed') {
        return EOF;
      }
    });
  }
});

test('Default ReadableStream returns `false` for all but the first `enqueue` call', t => {
  t.plan(5);

  new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('hi'), true);
      t.equal(enqueue('hey'), false);
      t.equal(enqueue('whee'), false);
      t.equal(enqueue('yo'), false);
      t.equal(enqueue('sup'), false);
    }
  });
});

test('ReadableStream continues returning `true` from `enqueue` if the data is read out of it in time', t => {
  t.plan(12);

  const rs = new ReadableStream({
    start(enqueue) {
      // Delay a bit so that the stream is successfully constructed and thus the `rs` variable references something.
      setTimeout(() => {
        t.equal(enqueue('foo'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'foo');
        t.equal(rs.state, 'waiting');

        t.equal(enqueue('bar'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'bar');
        t.equal(rs.state, 'waiting');

        t.equal(enqueue('baz'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'baz');
        t.equal(rs.state, 'waiting');
      }, 0);
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 4 })
  });
});

test('ReadableStream enqueue fails when the stream is draining', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      t.equal(enqueue('a'), true);
      close();

      t.throws(
        () => enqueue('b'),
        /TypeError/,
        'enqueue after close must throw a TypeError'
      );
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 10 })
  });

  t.equal(rs.state, 'readable');
  t.equal(rs.read(), 'a');
  t.equal(rs.state, 'closed');
  t.end();
});

test('ReadableStream enqueue fails when the stream is closed', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();

      t.throws(
        () => enqueue('a'),
        /TypeError/,
        'enqueue after close must throw a TypeError'
      );
    }
  });

  t.equal(rs.state, 'closed');
  t.end();
});

test('ReadableStream enqueue fails with the correct error when the stream is errored', t => {
  const expectedError = new Error('i am sad');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(expectedError);

      t.throws(
        () => enqueue('a'),
        /i am sad/,
        'enqueue after error must throw that error'
      );
    }
  });

  t.equal(rs.state, 'errored');
  t.end();
});

test('ReadableStream if shouldApplyBackpressure throws, the stream is errored', t => {
  const error = new Error('aaaugh!!');

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
        t.end();
      } catch (e) {
        t.equal(e, error);
      }
    },
    strategy: {
      size() {
        return 1;
      },

      shouldApplyBackpressure() {
        throw error;
      }
    }
  });

  rs.closed.catch(r => {
    t.equal(r, error);
    t.end();
  });
});

test('ReadableStream if size throws, the stream is errored', t => {
  const error = new Error('aaaugh!!');

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
        t.end();
      } catch (e) {
        t.equal(e, error);
      }
    },
    strategy: {
      size() {
        throw error;
      },

      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.closed.catch(r => {
    t.equal(r, error);
    t.end();
  });
});

test('ReadableStream if size is NaN, the stream is errored', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError);
      }
    },
    strategy: {
      size() {
        return NaN;
      },

      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('ReadableStream if size is -Infinity, the stream is errored', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError);
      }
    },
    strategy: {
      size() {
        return -Infinity;
      },

      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('ReadableStream if size is +Infinity, the stream is errored', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError);
      }
    },
    strategy: {
      size() {
        return +Infinity;
      },

      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('ReadableStream errors in shouldApplyBackpressure cause ready to fulfill and closed to rejected', t => {
  t.plan(3);

  const thrownError = new Error('size failure');
  let callsToShouldApplyBackpressure = 0;
  const rs = new ReadableStream({
    start(enqueue) {
      setTimeout(() => {
        try {
          enqueue('hi');
          t.fail('enqueue didn\'t throw');
        } catch (error) {
          t.equal(error, thrownError, 'error thrown by enqueue should be the thrown error');
        }
      }, 0);
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        if (++callsToShouldApplyBackpressure === 2) {
          throw thrownError;
        }

        return false;
      }
    }
  });

  rs.ready.then(
    v => t.equal(v, undefined, 'ready should be fulfilled with undefined'),
    e => t.fail('ready should not be rejected')
  );

  rs.closed.then(
    v => t.fail('closed should not be fulfilled'),
    e => t.equal(e, thrownError, 'closed should be rejected with the thrown error')
  );
});

test('ReadableStream cancel() and closed on a closed stream should return the same promise', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.cancel(), rs.closed, 'the promises returned should be the same');
  t.end();
});

test('ReadableStream ready returns the same value when called on a new, empty stream', t => {
  const rs = new ReadableStream();
  t.equal(rs.ready, rs.ready, 'rs.ready should not change between gets');
  t.end();
});

test('ReadableStream ready returns the same value when called on a readable stream', t => {
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
    }
  });

  t.equal(rs.ready, rs.ready, 'rs.ready should not change between gets');
  t.end();
});

test('ReadableStream cancel() and closed on an errored stream should return the same promise', t => {
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(new Error('boo!'));
    }
  });

  t.equal(rs.cancel(), rs.closed, 'the promises returned should be the same');
  t.end();
});

test('ReadableStream should call underlying source methods as methods', t => {
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
  theSource.debugName = "the source object passed to the constructor";
  const rs = new ReadableStream(theSource);

  rs.ready.then(() => rs.cancel());
});
