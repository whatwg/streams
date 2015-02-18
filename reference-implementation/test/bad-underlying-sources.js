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

  rs.closed.then(
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

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing pull getter (second pull)', t => {
  t.plan(4);

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

  t.equal(rs.state, 'readable', 'the stream should start readable');

  rs.read().then(v => {
    t.equal(rs.state, 'errored', 'the stream should be errored after the first read');
    t.equal(v, 'a', 'the chunk read should be correct');
  });

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying source: throwing pull method (second pull)', t => {
  t.plan(4);

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

  t.equal(rs.state, 'readable', 'the stream should start readable');

  rs.read().then(v => {
    t.equal(rs.state, 'errored', 'the stream should be errored after the first read');
    t.equal(v, 'a', 'the chunk read should be correct');
  });

  rs.closed.then(
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

  t.equal(rs.state, 'errored', 'state should be errored');
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

  t.equal(rs.state, 'errored', 'state should be errored');
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

  t.equal(rs.state, 'errored', 'state should be errored');
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

  t.equal(rs.state, 'errored', 'state should be errored');
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

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('Underlying source: strategy.size returning NaN', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
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

test('Underlying source: strategy.size returning -Infinity', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
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

test('Underlying source: strategy.size returning +Infinity', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(enqueue) {
      try {
        enqueue('hi');
        t.fail('enqueue didn\'t throw');
      } catch (error) {
        t.equal(error.constructor, RangeError, 'enqueue should throw a RangeError');
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
