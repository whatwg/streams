var test = require('tape');

import WritableStream from '../lib/writable-stream';

function writeArrayToStream(array, writableStream) {
  array.forEach(chunk => writableStream.write(chunk));
  return writableStream.close();
}

test('error argument is given to start method', t => {
  var error;
  var ws = new WritableStream({
    start(error_) {
      error = error_;
    }
  });

  // Now error the stream after its construction.
  var passedError = new Error('horrible things');
  error(passedError);
  t.equal(ws.state, 'errored');
  ws.closed.catch(r => {
    t.strictEqual(r, passedError);
    t.end();
  });
});

test('Underlying sink\'s write won\'t be called until start finishes', t => {
  var expectWriteCall = false;

  var resolveStartPromise;
  var ws = new WritableStream({
    start() {
      return new Promise(
          (resolve, reject) => { resolveStartPromise = resolve; });
    },
    write(chunk) {
      if (expectWriteCall) {
        t.equal(chunk, 'a');
        t.end();
      } else {
        t.fail('Unexpected write call');
        t.end();
      }
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    }
  });
  ws.write('a');
  t.equal(ws.state, 'waiting');

  // Wait and see that write won't be called.
  setTimeout(() => {
    expectWriteCall = true;
    resolveStartPromise();
  }, 100);
});

test('Underlying sink\'s close won\'t be called until start finishes', t => {
  var expectCloseCall = false;

  var resolveStartPromise;
  var ws = new WritableStream({
    start() {
      return new Promise(
          (resolve, reject) => { resolveStartPromise = resolve; });
    },
    write(chunk) {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      if (expectCloseCall) {
        t.end();
      } else {
        t.fail('Unexpected close call');
        t.end();
      }
    }
  });
  ws.close('a');
  t.equal(ws.state, 'closing');

  // Wait and see that write won't be called.
  setTimeout(() => {
    expectCloseCall = true;
    resolveStartPromise();
  }, 100);
});

test('Underlying sink\'s write or close are never invoked if start throws', t => {
  var passedError = new Error('horrible things');

  try {
    var ws = new WritableStream({
      start() {
        throw passedError;
      },
      write(chunk) {
        t.fail('Unexpected write call');
        t.end();
      },
      close() {
        t.fail('Unexpected close call');
        t.end();
      }
    });
  } catch (e) {
    t.strictEqual(e, passedError);
    t.end();
    return;
  }
  t.fail('Constructor didn\'t throw');
  t.end();
});

test('Underlying sink\'s write or close are never invoked if the promise returned by start is rejected', t => {
  var ws = new WritableStream({
    start() {
      return Promise.reject();
    },
    write(chunk) {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    }
  });

  // Wait and see that write or close won't be called.
  setTimeout(() => {
    t.end();
  }, 100);
});

test('WritableStream can be constructed with no arguments', t => {
  t.plan(1);
  t.doesNotThrow(() => new WritableStream(), 'WritableStream constructed with no errors');
});

test('WritableStream instances have the correct methods and properties', t => {
  t.plan(7);

  var ws = new WritableStream();

  t.equal(typeof ws.write, 'function', 'has a write method');
  t.equal(typeof ws.wait, 'function', 'has a wait method');
  t.equal(typeof ws.abort, 'function', 'has an abort method');
  t.equal(typeof ws.close, 'function', 'has a close method');

  t.equal(ws.state, 'writable', 'state starts out writable');

  t.ok(ws.closed, 'has a closed property');
  t.ok(ws.closed.then, 'closed property is thenable');
});

test('WritableStream with simple input, processed asynchronously', t => {
  t.plan(1);

  var storage;
  var ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk, done) {
      setTimeout(() => {
        storage.push(chunk);
        done();
      }, 0);
    },

    close() {
      return new Promise(resolve => setTimeout(resolve, 0));
    }
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream with simple input, processed synchronously', t => {
  t.plan(1);

  var storage;
  var ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk, done) {
      storage.push(chunk);
      done();
    },
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream stays writable indefinitely if writes are all acknowledged synchronously', t => {
  t.plan(10);

  var ws = new WritableStream({
    write(chunk, done) {
      t.equal(this.state, 'waiting', 'state is waiting before writing ' + chunk);
      done();
      t.equal(this.state, 'writable', 'state is writable after writing ' + chunk);
    }
  });

  // Wait for completion of start so that the underlying sink's write is
  // invoked synchronously.
  setTimeout(() => {
    var input = [1, 2, 3, 4, 5];
    writeArrayToStream(input, ws).then(
      () => t.end(),
      r => t.fail(r)
    );
  }, 0);
});

test('WritableStream transitions to waiting after one write that is not synchronously acknowledged', t => {
  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      done = done_;
    }
  });

  setTimeout(() => {
    t.strictEqual(ws.state, 'writable', 'state starts writable');
    ws.write('a');
    t.strictEqual(ws.state, 'waiting', 'state is waiting until the write finishes');
    done();
    t.strictEqual(ws.state, 'writable', 'state becomes writable again after the write finishes');

    t.end();
  }, 0);
});

test('WritableStream if sink calls error, queued write and close are cleared', t => {
  t.plan(6);

  var error;
  var ws = new WritableStream({
    write(chunk, done, error_) {
      error = error_;
    }
  });

  setTimeout(() => {
    var writePromise = ws.write('a');

    t.notStrictEqual(error, undefined, 'write is called and error is set');

    var writePromise2 = ws.write('b');
    var closedPromise = ws.close();

    t.strictEqual(ws.state, 'closing', 'state is closing until the close finishes');

    var passedError = new Error('horrible things');
    error(passedError);

    t.strictEqual(ws.state, 'errored', 'state is errored as the sink called error');

    writePromise.then(
      () => t.fail('writePromise is fulfilled unexpectedly'),
      r => t.strictEqual(r, passedError)
    );

    writePromise2.then(
      () => t.fail('writePromise2 is fulfilled unexpectedly'),
      r => t.strictEqual(r, passedError)
    );

    closedPromise.then(
      () => t.fail('closedPromise is fulfilled unexpectedly'),
      r => t.strictEqual(r, passedError)
    );
  }, 0);
});

test('If close is called on a WritableStream in writable state, wait will return a rejected promise', t => {
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    },
  });

  // Wait for ws to start.
  setTimeout(() => {
    t.strictEqual(ws.state, 'writable', 'state must be writable');

    ws.close();
    t.strictEqual(ws.state, 'closing', 'state must become closing synchronously on close call');

    ws.wait().then(
      () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
      r => {
        t.strictEqual(r.constructor, TypeError,
                      'wait() must start returning a promise rejected with a TypeError exception');
        t.end();
      }
    );
  }, 0);
});

test('If close is called on a WritableStream in waiting state, wait will return a rejected promise', t => {
  var ws = new WritableStream({
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    },
  });

  // Wait for ws to start.
  setTimeout(() => {
    ws.write('a');
    t.strictEqual(ws.state, 'waiting', 'state must become waiting synchronously on write call');

    ws.close();
    t.strictEqual(ws.state, 'closing', 'state must become closing synchronously on close call');

    ws.wait().then(
      () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
      r => {
        t.strictEqual(r.constructor, TypeError,
                      'wait() must start returning a promise rejected with a TypeError exception');
        t.end();
      }
    );
  }, 0);
});

test('If sink calls error on a WritableStream in writable state, wait will return a rejected promise', t => {
  t.plan(3);

  var error;
  var ws = new WritableStream({
    write(chunk, done, error_) {
      done();
      error = error_;
    }
  });

  setTimeout(() => {
    ws.write('a');
    t.strictEqual(ws.state, 'writable', 'state is writable as signalDone is called');

    var passedError = new Error('pass me');
    error(passedError);
    t.strictEqual(ws.state, 'errored', 'state is errored as error is called');

    ws.wait().then(
      () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
      r => t.strictEqual(r, passedError, 'wait() should be rejected with the passed error')
    );
  }, 0);
});

test('WritableStream if sink\'s close throws', t => {
  var passedError = new Error('pass me');
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      throw passedError;
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    },
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closedPromise = ws.close();
    t.strictEqual(ws.state, 'closing', 'state must become closing synchronously on close call');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
        t.strictEqual(ws.state, 'errored', 'state must be errored as error is called');

        ws.wait().then(
          () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
          r => {
            t.strictEqual(r, passedError, 'wait() should be rejected with the passed error');
            t.end();
          }
        );
      }
    );
  }, 0);
});

test('If sink calls error on a WritableStream in waiting state, wait will return a rejected promise', t => {
  t.plan(3);

  var error;
  var ws = new WritableStream({
    write(chunk, done, error_) {
      error = error_;
    }
  });

  setTimeout(() => {
    ws.write('a');
    t.strictEqual(ws.state, 'waiting', 'state is waiting as signalDone is not called');

    var passedError = new Error('pass me');
    error(passedError);
    t.strictEqual(ws.state, 'errored', 'state is errored as error is called');

    ws.wait().then(
      () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
      r => t.strictEqual(r, passedError, 'wait() should be rejected with the passed error')
    );
  }, 0);
});

test('WritableStream if sink throws an error after done, the stream becomes errored but the promise fulfills', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    write(chunk, done) {
      done();
      throw thrownError;
    }
  });

  setTimeout(() => {
    var writePromise = ws.write('a');
    t.strictEqual(ws.state, 'errored', 'state is errored after the sink throws');

    var closedPromise = ws.close();

    writePromise.then(
      () => t.pass('the promise returned from write should fulfill since done was called before throwing'),
      t.ifError
    );

    ws.close().then(
      () => t.fail('close() is fulfilled unexpectedly'),
      r => t.strictEqual(r, thrownError, 'close() should be rejected with the thrown error')
    );
  }, 0);
});

test('WritableStream if sink throws an error before done, the stream becomes errored and the promise rejects', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    write(chunk, done) {
      throw thrownError;
      done();
    }
  });

  setTimeout(() => {
    var writePromise = ws.write('a');
    t.strictEqual(ws.state, 'errored', 'state is errored after the sink throws');

    var closedPromise = ws.close();

    writePromise.then(
      () => t.fail('the write promise is fulfilled unexpectedly'),
      r => t.strictEqual(r, thrownError, 'the write promise should be rejected with the thrown error')
    );

    ws.close().then(
      () => t.fail('close() is fulfilled unexpectedly'),
      r => t.strictEqual(r, thrownError, 'close() should be rejected with the thrown error')
    );
  }, 0);
});

test('WritableStream exception in needsMore during write moves the stream into errored state', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    strategy: {
      size() {
        return 1;
      },
      needsMore() {
        throw thrownError;
      }
    }
  });
  ws.write('a').catch(r => {
    t.strictEqual(r, thrownError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as needsMore threw');
  ws.closed.catch(r => {
    t.strictEqual(r, thrownError);
  });
});

test('WritableStream exception in needsMore during signalDone moves the stream into errored state', t => {
  t.plan(4);

  var thrownError;

  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      done = done_;
    },
    strategy: {
      size() {
        return 1;
      },
      needsMore() {
        if (thrownError) {
          throw thrownError;
        } else {
          return true;
        }
      }
    }
  });

  setTimeout(() => {
    ws.write('a').then(() => {
      t.pass('The write must be successful');
    });
    t.equal(ws.state, 'writable', 'the state of ws must be still writable');

    thrownError = new Error('throw me');
    done();
    t.equal(ws.state, 'errored', 'the state of ws must be errored as needsMore threw');
    ws.closed.catch(r => {
      t.strictEqual(r, thrownError);
    });
  }, 0);
});
