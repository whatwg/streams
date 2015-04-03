const test = require('tape-catch');

test('Underlying sink: throwing start getter', t => {
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

test('Underlying sink: throwing start method', t => {
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

test('Underlying sink: throwing write getter', t => {
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

test('Underlying sink: throwing write method', t => {
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

test('Underlying sink: throwing abort getter', t => {
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

test('Underlying sink: throwing abort method', t => {
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

test('Underlying sink: throwing close getter', t => {
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

test('Underlying sink: throwing close method', t => {
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

test('Underlying sink: throwing strategy getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      get strategy() {
        throw theError;
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Underlying sink: throwing strategy.size getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      strategy: {
        get size() {
          throw theError;
        },
        highWaterMark: 5
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Underlying sink: throwing strategy.size method', t => {
  t.plan(3);

  const theError = new Error('a unique string');
  let ws;
  t.doesNotThrow(() => {
    ws = new WritableStream({
      strategy: {
        size() {
          throw theError;
        },
        highWaterMark: 5
      }
    });
  }, 'initial construction should not throw');

  ws.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  ws.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying sink: throwing strategy.highWaterMark getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
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

test('Underlying sink: invalid strategy.highWaterMark', t => {
  t.plan(5);

  for (const highWaterMark of [-1, -Infinity]) {
    t.throws(() => {
      new WritableStream({
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
      new WritableStream({
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

test('Underlying sink: negative strategy.highWaterMark', t => {
  t.plan(1);

  t.throws(() => {
    new WritableStream({
      strategy: {
        size() {
          return 1;
        },
        highWaterMark: -1
      }
    });
  }, /RangeError/, 'construction should throw a RangeError');
});
