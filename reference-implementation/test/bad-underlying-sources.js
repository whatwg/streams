const test = require('tape-catch');

test('Underlying source: throwing start getter', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      get start() {
        throw theError;
      }
    });
  }, /a unique string/, 'constructing the stream should re-throw the error');
  t.end();
});

test('Underlying source: throwing start method', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      start() {
        throw theError;
      }
    });
  }, /a unique string/, 'constructing the stream should re-throw the error');
  t.end();
});

test('Underlying source: throwing pull getter (initial pull)', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    get pull() {
      throw theError;
    }
  });

  rs.getReader().closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing pull method (initial pull)', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    pull() {
      throw theError;
    }
  });

  rs.getReader().closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing pull getter (second pull)', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  let counter = 0;
  const rs = new ReadableStream({
    get pull() {
      ++counter;
      if (counter === 1) {
        return c => c.enqueue('a');
      }

      throw theError;
    }
  });
  const reader = rs.getReader();

  reader.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'the chunk read should be correct'));

  reader.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing pull method (second pull)', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  let counter = 0;
  const rs = new ReadableStream({
    pull(c) {
      ++counter;
      if (counter === 1) {
        c.enqueue('a');
      } else {
        throw theError;
      }
    }
  });
  const reader = rs.getReader();

  reader.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'the chunk read should be correct'));

  reader.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing cancel getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    get cancel() {
      throw theError;
    }
  });

  rs.cancel().then(
    () => t.fail('cancel should not fulfill'),
    r => t.equal(r, theError, 'cancel should reject with the thrown error')
  );
});

test('Underlying source: throwing cancel method', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    cancel() {
      throw theError;
    }
  });

  rs.cancel().then(
    () => t.fail('cancel should not fulfill'),
    r => t.equal(r, theError, 'cancel should reject with the thrown error')
  );
});

test('Underlying source: throwing strategy getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      get strategy() {
        throw theError;
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Underlying source: throwing strategy.size getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      strategy: {
        get size() {
          throw theError;
        },
        highWaterMark: 5
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Underlying source: throwing strategy.size method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    start(c) {
      t.throws(() => c.enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    strategy: {
      size() {
        throw theError;
      },
      highWaterMark: 5
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: throwing strategy.highWaterMark getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      strategy: {
        size() {
          return 1;
        },
        get highWaterMark() {
          throw theError;
        }
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Underlying source: invalid strategy.highWaterMark', t => {
  t.plan(5);

  for (const highWaterMark of [-1, -Infinity]) {
    t.throws(() => {
      new ReadableStream({
        strategy: {
          size() {
            return 1;
          },
          highWaterMark
        }
      });
    }, /RangeError/, `construction should throw a RangeError for ${highWaterMark}`);
  }

  for (const highWaterMark of [NaN, 'foo', {}]) {
    t.throws(() => {
      new ReadableStream({
        strategy: {
          size() {
            return 1;
          },
          highWaterMark
        }
      });
    }, /TypeError/, `construction should throw a TypeError for ${highWaterMark}`);
  }
});

test('Underlying source: negative strategy.highWaterMark', t => {
  t.plan(1);

  t.throws(() => {
    new ReadableStream({
      strategy: {
        size() {
          return 1;
        },
        highWaterMark: -1
      }
    });
  }, /RangeError/, 'construction should throw a RangeError');
});

test('Underlying source: strategy.size returning NaN', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(c) {
      try {
        c.enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
        theError = error;
      }
    },
    strategy: {
      size() {
        return NaN;
      },
      highWaterMark: 5
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: strategy.size returning -Infinity', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(c) {
      try {
        c.enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
        theError = error;
      }
    },
    strategy: {
      size() {
        return -Infinity;
      },
      highWaterMark: 5
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: strategy.size returning +Infinity', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(c) {
      try {
        c.enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
        theError = error;
      }
    },
    strategy: {
      size() {
        return +Infinity;
      },
      highWaterMark: 5
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling enqueue on an empty canceled stream should not throw', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  rs.cancel();
  t.doesNotThrow(() => controller.enqueue('a'), 'calling enqueue after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling enqueue on a non-empty canceled stream should not throw', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      controller = c;
    }
  });

  rs.cancel();
  t.doesNotThrow(() => controller.enqueue('c'), 'calling enqueue after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling enqueue on a closed stream should throw', t => {
  t.plan(2);

  new ReadableStream({
    start(c) {
      c.close();
      t.throws(() => c.enqueue('a'), /TypeError/, 'call to enqueue should throw a TypeError');
    }
  })
  .getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling enqueue on an errored stream should throw', t => {
  t.plan(2);

  const theError = new Error('boo');
  new ReadableStream({
    start(c) {
      c.error(theError);
      t.throws(() => c.enqueue('a'), /boo/, 'call to enqueue should throw the error');
    }
  })
  .getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling close twice on an empty stream should throw the second time', t => {
  t.plan(2);

  new ReadableStream({
    start(c) {
      c.close();
      t.throws(() => c.close(), /TypeError/, 'second call to close should throw a TypeError');
    }
  })
  .getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close twice on a non-empty stream should throw the second time', t => {
  t.plan(3);

  const reader = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.close();
      t.throws(() => c.close(), /TypeError/, 'second call to close should throw a TypeError');
    }
  })
  .getReader();

  reader.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'read() should read the enqueued chunk'));
  reader.closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close on an empty canceled stream should not throw', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  rs.cancel();
  t.doesNotThrow(() => controller.close(), 'calling close after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close on a non-empty canceled stream should not throw', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
      c.enqueue('a');
    }
  });

  rs.cancel();
  t.doesNotThrow(() => controller.close(), 'calling close after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close after error should throw', t => {
  t.plan(2);

  const theError = new Error('boo');
  new ReadableStream({
    start(c) {
      c.error(theError);
      t.throws(() => c.close(), /TypeError/, 'call to close should throw a TypeError');
    }
  })
  .getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling error twice should throw the second time', t => {
  t.plan(2);

  const theError = new Error('boo');
  new ReadableStream({
    start(c) {
      c.error(theError);
      t.throws(() => c.error(), /TypeError/, 'second call to error should throw a TypeError');
    }
  })
  .getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling error after close should throw', t => {
  t.plan(2);

  new ReadableStream({
    start(c) {
      c.close();
      t.throws(() => c.error(), /TypeError/, 'call to error should throw a TypeError');
    }
  })
  .getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling error and returning a rejected promise from start should cause the stream to error ' +
     'with the first error', t => {
  t.plan(1);

  const firstError = new Error('1');
  const secondError = new Error('2');
  new ReadableStream({
    start(c) {
      c.error(firstError);

      return Promise.reject(secondError);
    }
  })
  .getReader().closed.catch(e => t.equal(e, firstError, 'stream should error with the first error'));
});

test('Underlying source: calling error and returning a rejected promise from pull should cause the stream to error ' +
     'with the first error', t => {
  t.plan(1);

  const firstError = new Error('1');
  const secondError = new Error('2');
  new ReadableStream({
    pull(c) {
      c.error(firstError);

      return Promise.reject(secondError);
    }
  })
  .getReader().closed.catch(e => t.equal(e, firstError, 'stream should error with the first error'));
});
