const test = require('tape-catch');

import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream can be constructed with no errors', t => {
  t.doesNotThrow(() => new ReadableStream(), 'ReadableStream constructed with no parameters');
  t.doesNotThrow(() => new ReadableStream({ }), 'ReadableStream constructed with an empty object as parameter');
  t.doesNotThrow(() => new ReadableStream(undefined), 'ReadableStream constructed with undefined as parameter');
  let x;
  t.doesNotThrow(() => new ReadableStream(x), 'ReadableStream constructed with an undefined variable as parameter');
  t.end();
});

test('ReadableStream can\'t be constructed with garbage', t => {
  t.throws(() => new ReadableStream(null), /TypeError/, 'constructor should throw when the source is null');
  t.end();
});

test('ReadableStream instances should have the correct list of properties', t => {
  const methods = ['cancel', 'constructor', 'getReader', 'pipeThrough', 'pipeTo', 'tee'];

  const rs = new ReadableStream();
  const proto = Object.getPrototypeOf(rs);

  t.deepEqual(Object.getOwnPropertyNames(proto).sort(), methods, 'should have all the correct methods');

  for (let m of methods) {
    const propDesc = Object.getOwnPropertyDescriptor(proto, m);
    t.equal(propDesc.enumerable, false, `${m} should be non-enumerable`);
    t.equal(propDesc.configurable, true, `${m} should be configurable`);
    t.equal(propDesc.writable, true, `${m} should be writable`);
    t.equal(typeof rs[m], 'function', `should have a ${m} method`);
  }

  t.equal(rs.cancel.length, 1, 'cancel should have 1 parameter');
  t.equal(rs.constructor.length, 0, 'constructor should have no parameters');
  t.equal(rs.getReader.length, 0, 'getReader should have no parameters');
  t.equal(rs.pipeThrough.length, 2, 'pipeThrough should have 2 parameters');
  t.equal(rs.pipeTo.length, 1, 'pipeTo should have 1 parameter');
  t.equal(rs.tee.length, 0, 'tee should have no parameters');

  t.end();
});

test('ReadableStream constructor should throw for non-function start arguments', t => {
  t.plan(1);

  t.throws(() => new ReadableStream({ start: 'potato' }), /TypeError/,
    'constructor should throw when start is not a function');
});

test('ReadableStream constructor can get initial garbage as cancel argument', t => {
  t.plan(1);

  t.doesNotThrow(() => new ReadableStream({ cancel: '2'}),
    'constructor should not throw when cancel is not a function');
});

test('ReadableStream constructor can get initial garbage as pull argument', t => {
  t.plan(1);

  t.doesNotThrow(() => new ReadableStream({ pull: { } }), 'constructor should not throw when pull is not a function');
});

test('ReadableStream constructor cannot get initial garbage as strategy argument', t => {
  t.plan(1);

  t.throws(() => new ReadableStream({ strategy: 2 }), /TypeError/,
    'constructor should throw when strategy is not an object');
});

test('ReadableStream start should be called with the proper parameters', t => {
  t.plan(29);

  const source = {
    start(controller) {
      t.equal(this, source, 'source is this during start');

      const unnamedMethods = [ 'close', 'enqueue', 'error' ];
      const methods = unnamedMethods.concat(['constructor']).sort();
      const proto = Object.getPrototypeOf(controller);

      t.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort(), methods,
                  'the controller should have the right methods');

      for (let m of unnamedMethods) {
        t.equal(controller[m].name, '', `${m} should have no name`);
      }

      for (let m of methods) {
        const methodProperties = [ 'arguments', 'caller', 'length', 'name', 'prototype' ];
        const propDesc = Object.getOwnPropertyDescriptor(proto, m);
        t.equal(propDesc.enumerable, false, `${m} should be non-enumerable`);
        t.equal(propDesc.configurable, true, `${m} should be configurable`);
        t.equal(propDesc.writable, true, `${m} should be writable`);
        t.equal(typeof controller[m], 'function', `should have a ${m} method`);
        t.deepEqual(Object.getOwnPropertyNames(controller[m]).sort(), methodProperties, `${m} should have the right properties`);
      }

      t.equal(controller.close.length, 0, 'close should have no parameters');
      t.equal(controller.constructor.length, 1, 'constructor should have 1 parameters');
      t.equal(controller.enqueue.length, 1, 'enqueue should have 1 parameter');
      t.equal(controller.error.length, 1, 'error should have 1 parameter');
    }
  };

  const rs = new ReadableStream(source);
});

test('ReadableStream start controller parameter should be updatable', t => {
  t.plan(3);

  const source = {
    start(controller) {
      const methods = [ 'close', 'constructor', 'enqueue', 'error' ];
      t.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort(), methods,
                  'prototype should have the right methods');
      controller.test = "";
      t.deepEqual(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort(), methods,
                  'prototype should still have the right methods');
      t.notEqual(Object.getOwnPropertyNames(controller).indexOf('test'), '\'test\' is a property of the controller');
    }
  };

  const rs = new ReadableStream(source);
});

test('ReadableStream should be able to call start method within prototype chain of its source', t => {
  t.plan(1);

  const SimpleStreamSource = function() { };
  SimpleStreamSource.prototype.start = function() { t.pass('start should be called'); };
  SimpleStreamSource.prototype.constructor = SimpleStreamSource;

  const rs = new ReadableStream(new SimpleStreamSource());
});

test('ReadableStream start should be able to return a promise', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(c) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          c.enqueue('a');
          c.close();
          resolve();
        }, 50);
      });
    },
  });

  const reader = rs.getReader();

  reader.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'value read should be the one enqueued'));

  reader.closed.then(() => t.pass('stream should close successfully'));
});

test('ReadableStream start should be able to return a promise and reject it', t => {
  t.plan(1);

  const theError = new Error('rejected!');
  const rs = new ReadableStream({
    start() {
      return new Promise((resolve, reject) => setTimeout(() => reject(theError), 50));
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'promise should be rejected with the same error'));
});

test('ReadableStream should be able to enqueue different objects', t => {
  t.plan(4);

  const objects = [
    { potato: 'Give me more!'},
    'test',
    1
  ];

  const rs = new ReadableStream({
    start(c) {
      for (let o of objects) {
        c.enqueue(o);
      }
      c.close();
    }
  });

  const reader = rs.getReader();

  for (let o of objects) {
    reader.read().then(r => t.deepEqual(r, { value: o, done: false }, 'value read should be the one enqueued'));
  }

  reader.closed.then(() => t.pass('stream should close correctly correctly'));
});

test('ReadableStream: if pull rejects, it should error the stream', t => {
  t.plan(2);

  const error = new Error('pull failure');
  const rs = new ReadableStream({
    pull() {
      return Promise.reject(error);
    }
  });

  const reader = rs.getReader();

  reader.closed.catch(e => {
    t.equal(e, error, 'closed should reject with the thrown error');
  });

  reader.read().catch(e => {
    t.equal(e, error, 'read() should reject with the thrown error');
  });
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

test('ReadableStream: should call pull when trying to read from a started, empty stream', t => {
  t.plan(3);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull(c) {
      // Don't enqueue immediately after start. We want the stream to be empty when we call .read() on it.
      if (pullCount > 0) {
        c.enqueue(pullCount);
      }

      ++pullCount;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should be called once start finishes');

    const reader = rs.getReader();
    return reader.read().then(result => {
      t.equal(pullCount, 2, 'pull should be called again in reaction to calling read');
      t.deepEqual(result, { value: 1, done: false }, 'the result read should be the one enqueued');
    });
  })
  .catch(e => t.error(e));
});

test('ReadableStream: should only call pull once on a non-empty stream read from before start fulfills', t => {
  t.plan(5);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
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

test('ReadableStream: should only call pull once on a non-empty stream read from after start fulfills', t => {
  t.plan(4);

  let pullCount = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      return startPromise;
    },
    pull() {
      pullCount++;
    }
  });

  startPromise.then(() => {
    t.equal(pullCount, 0, 'pull should not be called once start finishes, since the queue is full');

    rs.getReader().read().then(r => {
      t.deepEqual(r, { value: 'a', done: false }, 'first read() should return first chunk');

      setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
    });

    t.equal(pullCount, 1, 'calling read() should not cause pull to be called immediately');
  });
});

test('ReadableStream: should call pull in reaction to read()ing the last chunk, if not draining', t => {
  t.plan(4);

  let pullCount = 0;
  let controller;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(c) {
      controller = c;
      return startPromise;
    },
    pull() {
      ++pullCount;
    }
  });

  const reader = rs.getReader();

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should have been called once by the time the stream starts');

    controller.enqueue('a');
    t.equal(pullCount, 1, 'pull should not have been called again after enqueue');

    return reader.read().then(() => {
      t.equal(pullCount, 2, 'pull should have been called again after read');

      setTimeout(() => t.equal(pullCount, 2, 'pull should be called exactly twice'), 50);
    });
  })
  .catch(e => t.error(e));
});

test('ReadableStream: should not call pull() in reaction to read()ing the last chunk, if draining', t => {
  t.plan(4);

  let pullCount = 0;
  let controller;
  const startPromise = Promise.resolve();
  const pullPromise = Promise.resolve();
  const rs = new ReadableStream({
    start(c) {
      controller = c;
      return startPromise;
    },
    pull() {
      ++pullCount;
      return pullPromise;
    }
  });

  const reader = rs.getReader();

  startPromise.then(() => {
    t.equal(pullCount, 1, 'pull should have been called once by the time the stream starts');

    controller.enqueue('a');
    t.equal(pullCount, 1, 'pull should not have been called again after enqueue');

    controller.close();

    return reader.read().then(() => {
      t.equal(pullCount, 1, 'pull should not have been called a second time after read');

      setTimeout(() => t.equal(pullCount, 1, 'pull should be called exactly once'), 50);
    });
  })
  .catch(e => t.error(e));

});

test('ReadableStream: should not call pull until the previous pull call\'s promise fulfills', t => {
  let resolve;
  let returnedPromise;
  let timesCalled = 0;
  const startPromise = Promise.resolve();
  const rs = new ReadableStream({
    start() {
      return startPromise;
    },
    pull(c) {
      c.enqueue(++timesCalled);
      returnedPromise = new Promise(r => { resolve = r; });
      return returnedPromise;
    }
  });
  const reader = rs.getReader();

  startPromise.then(() =>
    reader.read().then(result1 => {
      t.equal(timesCalled, 1,
        'pull should have been called once after start, but not yet have been called a second time');
      t.deepEqual(result1, { value: 1, done: false }, 'read() should fulfill with the enqueued value');

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
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.enqueue('c');
      return startPromise;
    },
    pull() {
      ++timesCalled;
    },
    strategy: {
      size() {
        return 1;
      },
      highWaterMark: Infinity
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
    start(c) {
      c.enqueue('a');
      c.close();
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

      return reader.closed.then(() => {
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
    pull(c) {
      c.enqueue(++timesCalled);
    },
    strategy: {
      size() {
        return 1;
      },
      highWaterMark: 4
    }
  });

  setTimeout(() => {
    // after start: size = 0, pull()
    // after enqueue(1): size = 1, pull()
    // after enqueue(2): size = 2, pull()
    // after enqueue(3): size = 3, pull()
    // after enqueue(4): size = 4, do not pull
    t.equal(timesCalled, 4, 'pull() should have been called four times');
    t.end();
  }, 50);
});

test('ReadableStream pull should be able to close a stream', t => {
  t.plan(1);

  const rs = new ReadableStream({
    pull(c) {
      c.close();
    }
  });

  const reader = rs.getReader();
  reader.closed.then(() => t.pass('stream was closed successfully'));
});

test('ReadableStream: enqueue should throw when the stream is readable but draining', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(c) {
      t.equal(c.enqueue('a'), undefined, 'the first enqueue should return undefined');
      c.close();

      t.throws(
        () => c.enqueue('b'),
        /TypeError/,
        'enqueue after close should throw a TypeError'
      );
    }
  });
});

test('ReadableStream: enqueue should throw when the stream is closed', t => {
  t.plan(1);

  const rs = new ReadableStream({
    start(c) {
      c.close();

      t.throws(
        () => c.enqueue('a'),
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
    start(c) {
      c.error(expectedError);

      t.throws(
        () => c.enqueue('a'),
        /i am sad/,
        'enqueue after error should throw that error'
      );
    }
  });
});


test('ReadableStream: should call underlying source methods as methods', t => {
  t.plan(4);

  class Source {
    start(c) {
      t.equal(this, theSource, 'start() should be called with the correct this');
      c.enqueue('a');
    }

    pull() {
      t.equal(this, theSource, 'pull() should be called with the correct this');
    }

    cancel() {
      t.equal(this, theSource, 'cancel() should be called with the correct this');
    }

    get strategy() {
      t.equal(this, theSource, 'strategy getter should be called with the correct this');
      return undefined;
    }
  }

  const theSource = new Source();
  theSource.debugName = 'the source object passed to the constructor'; // makes test failures easier to diagnose
  const rs = new ReadableStream(theSource);

  const reader = rs.getReader();
  reader.read().then(() => {
    reader.releaseLock();
    rs.cancel();
  })
  .catch(e => t.error(e));
});

test('ReadableStream strategies: the default strategy should give desiredSize of 1 to start, decreasing by 1 ' +
     'per enqueue', t => {
  t.plan(5);

  new ReadableStream({
    start(c) {
      t.equal(c.desiredSize, 1);
      c.enqueue('a');
      t.equal(c.desiredSize, 0);
      c.enqueue('b');
      t.equal(c.desiredSize, -1);
      c.enqueue('c');
      t.equal(c.desiredSize, -2);
      c.enqueue('d');
      t.equal(c.desiredSize, -3);
      c.enqueue('e');
    }
  });
});

test('ReadableStream strategies: the default strategy should continue giving desiredSize of 1 if the chunks are ' +
     'read immediately', t => {
  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });
  const reader = rs.getReader();

  t.equal(controller.desiredSize, 1, 'desiredSize should start at 1');
  controller.enqueue('a');
  t.equal(controller.desiredSize, 0, 'desiredSize should decrease to 0 after first enqueue');

  reader.read().then(result1 => {
    t.deepEqual(result1, { value: 'a', done: false }, 'first chunk read should be correct');

    t.equal(controller.desiredSize, 1, 'desiredSize should go up to 1 after the first read');
    controller.enqueue('b');
    t.equal(controller.desiredSize, 0, 'desiredSize should go down to 0 after the second enqueue');

    return reader.read();
  })
  .then(result2 => {
    t.deepEqual(result2, { value: 'b', done: false }, 'second chunk read should be correct');

    t.equal(controller.desiredSize, 1, 'desiredSize should go up to 1 after the second read');
    controller.enqueue('c');
    t.equal(controller.desiredSize, 0, 'desiredSize should go down to 0 after the third enqueue');

    return reader.read();
  })
  .then(result3 => {
    t.deepEqual(result3, { value: 'c', done: false }, 'third chunk read should be correct');

    t.equal(controller.desiredSize, 1, 'desiredSize should go up to 1 after the third read');
    controller.enqueue('d');
    t.equal(controller.desiredSize, 0, 'desiredSize should go down to 0 after the fourth enqueue');

    t.end();
  })
  .catch(e => t.error(e));
});

test('ReadableStream integration test: adapting a random push source', t => {
  let pullChecked = false;
  const randomSource = new RandomPushSource(8);

  const rs = new ReadableStream({
    start(c) {
      t.equal(typeof c.enqueue,  'function', 'enqueue should be a function in start');
      t.equal(typeof c.close, 'function', 'close should be a function in start');
      t.equal(typeof c.error, 'function', 'error should be a function in start');

      randomSource.ondata = chunk => {
        if (c.enqueue(chunk) <= 0) {
          randomSource.readStop();
        }
      };

      randomSource.onend = c.close.bind(c);
      randomSource.onerror = c.error.bind(c);
    },

    pull(c) {
      if (!pullChecked) {
        pullChecked = true;
        t.equal(typeof c.enqueue, 'function', 'enqueue should be a function in pull');
        t.equal(typeof c.close, 'function', 'close should be a function in pull');
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
