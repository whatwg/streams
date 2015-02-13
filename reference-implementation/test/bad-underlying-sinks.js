const test = require('tape');

test('Throwing underlying sink start getter', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      get start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying sink start method', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying source write getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    get write() {
      throw theError;
    }
  });

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source write method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    write() {
      throw theError;
    }
  });

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying sink abort getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const abortReason = new Error('different string');
  const ws = new WritableStream({
    get abort() {
      throw theError;
    }
  });

  ws.abort(abortReason).then(
    () => t.fail('abort should not fulfill'),
    r => t.equal(r, theError, 'abort should reject with the abort reason')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, abortReason, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying sink abort method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const abortReason = new Error('different string');
  const ws = new WritableStream({
    abort() {
      throw theError;
    }
  });

  ws.abort(abortReason).then(
    () => t.fail('abort should not fulfill'),
    r => t.equal(r, theError, 'abort should reject with the abort reason')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, abortReason, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying sink close getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    get close() {
      throw theError;
    }
  });

  ws.close().then(
    () => t.fail('close should not fulfill'),
    r => t.equal(r, theError, 'close should reject with the thrown error')
  );
});

test('Throwing underlying sink close method', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    close() {
      throw theError;
    }
  });

  ws.close().then(
    () => t.fail('close should not fulfill'),
    r => t.equal(r, theError, 'close should reject with the thrown error')
  );
});

test('Throwing underlying source strategy getter: initial construction', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      get strategy() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying source strategy getter: first write', t => {
  t.plan(2);

  let counter = 0;
  const theError = new Error('a unique string');
  const ws = new WritableStream({
    get strategy() {
      ++counter;
      if (counter === 1) {
        return {
          size() {
            return 1;
          },
          shouldApplyBackpressure() {
            return true;
          }
        };
      }

      throw theError;
    }
  });

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source strategy.size getter: initial construction', t => {
  t.doesNotThrow(() => {
    new WritableStream({
      strategy: {
        get size() {
          throw new Error('boo');
        },
        shouldApplyBackpressure() {
          return true;
        }
      }
    });
  });
  t.end();
});

test('Throwing underlying source strategy.size method: initial construction', t => {
  t.doesNotThrow(() => {
    new WritableStream({
      strategy: {
        size() {
          throw new Error('boo');
        },
        shouldApplyBackpressure() {
          return true;
        }
      }
    });
  });
  t.end();
});

test('Throwing underlying source strategy.size getter: first write', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    strategy: {
      get size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source strategy.size method: first write', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    strategy: {
      size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source strategy.shouldApplyBackpressure getter: initial construction', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      strategy: {
        size() {
          return 1;
        },
        get shouldApplyBackpressure() {
          throw theError;
        }
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying source strategy.shouldApplyBackpressure method: initial construction', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      strategy: {
        size() {
          return 1;
        },
        shouldApplyBackpressure() {
          throw theError;
        }
      }
    });
  }, /a unique string/);
  t.end();
});
