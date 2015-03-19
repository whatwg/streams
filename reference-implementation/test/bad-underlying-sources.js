const test = require('tape-catch');

test('Underlying source start: throwing getter', t => {
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

test('Underlying source start: throwing method', t => {
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
        return enqueue => enqueue('a');
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
    pull(enqueue) {
      ++counter;
      if (counter === 1) {
        enqueue('a');
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
  t.plan(2);

  const theError = new Error('a unique string');

  const rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    get strategy() {
      throw theError;
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: throwing strategy.size getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    strategy: {
      get size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: throwing strategy.size method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    strategy: {
      size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: throwing strategy.shouldApplyBackpressure getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    strategy: {
      size() {
        return 1;
      },
      get shouldApplyBackpressure() {
        throw theError;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: throwing strategy.shouldApplyBackpressure method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/, 'enqueue should throw the error');
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        throw theError;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: strategy.size returning NaN', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
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
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: strategy.size returning -Infinity', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
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
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: strategy.size returning +Infinity', t => {
  t.plan(2);

  let theError;
  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
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
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling close twice on an empty stream should throw the second time', t => {
  t.plan(2);

  new ReadableStream({
    start(enqueue, close) {
      close();
      t.throws(close, /TypeError/, 'second call to close should throw a TypeError');
    }
  })
  .getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close twice on a non-empty stream should throw the second time', t => {
  t.plan(3);

  const reader = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      close();
      t.throws(close, /TypeError/, 'second call to close should throw a TypeError');
    }
  })
  .getReader();

  reader.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'read() should read the enqueued chunk'));
  reader.closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close on an empty canceled stream should not throw', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  rs.cancel();
  t.doesNotThrow(doClose, 'calling close after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close on a non-empty canceled stream should not throw', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      doClose = close;
    }
  });

  rs.cancel();
  t.doesNotThrow(doClose, 'calling close after canceling should not throw anything');

  rs.getReader().closed.then(() => t.pass('closed should fulfill'));
});

test('Underlying source: calling close after error should throw', t => {
  t.plan(2);

  const theError = new Error('boo');
  new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
      t.throws(close, /TypeError/, 'call to close should throw a TypeError');
    }
  })
  .getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling error twice should throw the second time', t => {
  t.plan(2);

  const theError = new Error('boo');
  new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
      t.throws(error, /TypeError/, 'second call to error should throw a TypeError');
    }
  })
  .getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Underlying source: calling error after close should throw', t => {
  t.plan(2);

  new ReadableStream({
    start(enqueue, close, error) {
      close();
      t.throws(error, /TypeError/, 'call to error should throw a TypeError');
    }
  })
  .getReader().closed.then(() => t.pass('closed should fulfill'));
});
