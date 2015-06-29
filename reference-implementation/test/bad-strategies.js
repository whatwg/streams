const test = require('tape-catch');

test('Readable stream: throwing strategy.size getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({}, {
      get size() {
        throw theError;
      },
      highWaterMark: 5
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Readable stream: throwing strategy.size method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const rs = new ReadableStream(
    {
      start(c) {
        t.throws(() => c.enqueue('a'), /a unique string/, 'enqueue should throw the error');
      }
    },
    {
      size() {
        throw theError;
      },
      highWaterMark: 5
    }
  );

  rs.getReader().closed.catch(e => t.equal(e, theError, 'closed should reject with the error'));
});

test('Readable stream: throwing strategy.highWaterMark getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({}, {
      size() {
        return 1;
      },
      get highWaterMark() {
        throw theError;
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Readable stream: invalid strategy.highWaterMark', t => {
  t.plan(5);

  for (const highWaterMark of [-1, -Infinity]) {
    t.throws(() => {
      new ReadableStream({}, {
        size() {
          return 1;
        },
        highWaterMark
      });
    }, /RangeError/, `construction should throw a RangeError for ${highWaterMark}`);
  }

  for (const highWaterMark of [NaN, 'foo', {}]) {
    t.throws(() => {
      new ReadableStream({}, {
        size() {
          return 1;
        },
        highWaterMark
      });
    }, /TypeError/, `construction should throw a TypeError for ${highWaterMark}`);
  }
});

test('Readable stream: negative strategy.highWaterMark', t => {
  t.plan(1);

  t.throws(() => {
    new ReadableStream({}, {
      size() {
        return 1;
      },
      highWaterMark: -1
    });
  }, /RangeError/, 'construction should throw a RangeError');
});

test('Readable stream: invalid strategy.size return value', t => {
  t.plan(8);

  for (const size of [NaN, -Infinity, +Infinity, -1]) {
    let theError;
    const rs = new ReadableStream(
      {
        start(c) {
          try {
            c.enqueue('hi');
            t.fail('enqueue didn\'t throw');
          } catch (error) {
            t.equal(error.constructor, RangeError, `enqueue should throw a RangeError for ${size}`);
            theError = error;
          }
        }
      },
      {
        size() {
          return size;
        },
        highWaterMark: 5
      }
    );

    rs.getReader().closed.catch(e => t.equal(e, theError, `closed should reject with the error for ${size}`));
  }
});

test('Writable stream: throwing strategy.size getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({}, {
      get size() {
        throw theError;
      },
      highWaterMark: 5
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Writable stream: throwing strategy.size method', t => {
  t.plan(3);

  const theError = new Error('a unique string');
  let ws;
  t.doesNotThrow(() => {
    ws = new WritableStream({}, {
      size() {
        throw theError;
      },
      highWaterMark: 5
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

test('Writable stream: invalid strategy.size return value', t => {
  t.plan(8);

  for (const size of [NaN, -Infinity, +Infinity, -1]) {
    let theError;
    const ws = new WritableStream({}, {
      size() {
        return size;
      },
      highWaterMark: 5
    });

    ws.write('a').then(
      () => t.fail('write should not fulfill'),
      r => {
        t.equal(r.constructor, RangeError, `write should reject with a RangeError for ${size}`);
        theError = r;
      });

    ws.closed.catch(e => t.equal(e, theError, `closed should reject with the error for ${size}`));
  }
});

test('Writable stream: throwing strategy.highWaterMark getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({}, {
      size() {
        return 1;
      },
      get highWaterMark() {
        throw theError;
      }
    });
  }, /a unique string/, 'construction should re-throw the error');
});

test('Writable stream: invalid strategy.highWaterMark', t => {
  t.plan(5);

  for (const highWaterMark of [-1, -Infinity]) {
    t.throws(() => {
      new WritableStream({}, {
        size() {
          return 1;
        },
        highWaterMark
      });
    }, /RangeError/, `construction should throw a RangeError for ${highWaterMark}`);
  }

  for (const highWaterMark of [NaN, 'foo', {}]) {
    t.throws(() => {
      new WritableStream({}, {
        size() {
          return 1;
        },
        highWaterMark
      });
    }, /TypeError/, `construction should throw a TypeError for ${highWaterMark}`);
  }
});

test('Writable stream: negative strategy.highWaterMark', t => {
  t.plan(1);

  t.throws(() => {
    new WritableStream({}, {
      size() {
        return 1;
      },
      highWaterMark: -1
    });
  }, /RangeError/, 'construction should throw a RangeError');
});
