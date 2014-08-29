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

    write(chunk) {
      return new Promise(resolve => {
        setTimeout(() => {
          storage.push(chunk);
          resolve();
        }, 0);
      });
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

    write(chunk) {
      storage.push(chunk);
    },
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream wait() fulfills immediately if the stream is writable', t => {
  var ws = new WritableStream({
    strategy: { shouldApplyBackpressure() { return true; } }
  });

  ws.wait().then(() => {
    t.pass('wait() promise was fulfilled');
    t.end();
  });
});

test('WritableStream transitions to waiting until write is acknowledged', t => {
  t.plan(3);

  var resolveWritePromise;
  var ws = new WritableStream({
    write() {
      return new Promise(resolve => resolveWritePromise = resolve);
    }
  });

  setTimeout(() => {
    t.strictEqual(ws.state, 'writable', 'state starts writable');
    var writePromise = ws.write('a');
    t.strictEqual(ws.state, 'waiting', 'state is waiting until the write finishes');
    resolveWritePromise();
    writePromise.then(() => {
      t.strictEqual(ws.state, 'writable', 'state becomes writable again after the write finishes');
    });
  }, 0);
});

test('WritableStream if write returns a rejected promise, queued write and close are cleared', t => {
  t.plan(6);

  var rejectWritePromise;
  var ws = new WritableStream({
    write() {
      return new Promise((r, reject) => rejectWritePromise = reject);
    }
  });

  setTimeout(() => {
    var writePromise = ws.write('a');

    t.notStrictEqual(rejectWritePromise, undefined, 'write is called so rejectWritePromise is set');

    var writePromise2 = ws.write('b');
    var closedPromise = ws.close();

    t.strictEqual(ws.state, 'closing', 'state is closing until the close finishes');

    var passedError = new Error('horrible things');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('writePromise is fulfilled unexpectedly'),
      r => {
        t.strictEqual(r, passedError);
        t.strictEqual(ws.state, 'errored', 'state is errored as the sink called error');

        writePromise2.then(
          () => t.fail('writePromise2 is fulfilled unexpectedly'),
          r => t.strictEqual(r, passedError)
        );

        closedPromise.then(
          () => t.fail('closedPromise is fulfilled unexpectedly'),
          r => t.strictEqual(r, passedError)
        );
      }
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

test('If sink rejects on a WritableStream in writable state, wait will return a rejected promise', t => {
  t.plan(5);

  var rejectWritePromise;
  var ws = new WritableStream({
    write() {
      return new Promise((r, reject) => rejectWritePromise = reject);
    }
  });

  setTimeout(() => {
    t.strictEqual(ws.state, 'writable', 'state is writable to begin');
    var writePromise = ws.write('a');
    t.strictEqual(ws.state, 'waiting', 'state is waiting after a write');

    var passedError = new Error('pass me');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.strictEqual(r, passedError, 'write() should be rejected with the passed error');
        t.strictEqual(ws.state, 'errored', 'state is errored as error is called');

        ws.wait().then(
          () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
          r => t.strictEqual(r, passedError, 'wait() should be rejected with the passed error')
        );
      }
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

test('If sink rejects on a WritableStream in waiting state, wait will return a rejected promise', t => {
  t.plan(5);

  var passedError = new Error('pass me');
  var ws = new WritableStream({
    write(chunk) {
      if (chunk === 'first chunk succeeds') {
        return new Promise(resolve => setTimeout(resolve, 10));
      }
      return Promise.reject(passedError);
    }
  });

  setTimeout(() => {
    ws.write('first chunk succeeds');
    t.strictEqual(ws.state, 'waiting', 'state is waiting after first write');

    var secondWritePromise = ws.write('all other chunks fail');
    t.strictEqual(ws.state, 'waiting', 'state is waiting after a second write');

    secondWritePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.strictEqual(r, passedError, 'write() should be rejected with the passed error');
        t.strictEqual(ws.state, 'errored', 'state is errored as error is called');

        ws.wait().then(
          () => t.fail('wait on ws returned a fulfilled promise unexpectedly'),
          r => t.strictEqual(r, passedError, 'wait() should be rejected with the passed error')
        );
      }
    );
  }, 0);
});

test('WritableStream if sink throws an error inside write, the stream becomes errored and the promise rejects', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    write() {
      throw thrownError;
    }
  });

  ws.write('a').then(
    () => t.fail('write promise was unexpectedly fulfilled'),
    r => {
      t.strictEqual(r, thrownError, 'write() should reject with the thrown error');
      t.strictEqual(ws.state, 'errored', 'state is errored');

      ws.close().then(
        () => t.fail('close() is fulfilled unexpectedly'),
        r => t.strictEqual(r, thrownError, 'close() should be rejected with the thrown error')
      );
    }
  );
});

test('WritableStream exception in shouldApplyBackpressure during write moves the stream into errored state', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        throw thrownError;
      }
    }
  });
  ws.write('a').catch(r => {
    t.strictEqual(r, thrownError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as shouldApplyBackpressure threw');
  ws.closed.catch(r => {
    t.strictEqual(r, thrownError);
  });
});

test('WritableStream exception in shouldApplyBackpressure moves the stream into errored state but previous writes ' +
     'finish', t => {
  t.plan(4);

  var thrownError;

  var resolveWritePromise;
  var ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => resolveWritePromise = resolve);
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        if (thrownError) {
          throw thrownError;
        } else {
          return false;
        }
      }
    }
  });

  setTimeout(() => {
    ws.write('a').then(() => {
      t.pass('The write must be successful as the underlying sink acknowledged it');

      t.equal(ws.state, 'errored', 'the state of ws must be errored as shouldApplyBackpressure threw');
      ws.closed.catch(r => {
        t.strictEqual(r, thrownError);
      });
    });
    t.equal(ws.state, 'writable', 'the state of ws must be still writable');

    thrownError = new Error('throw me');
    resolveWritePromise();
  }, 0);
});

test('WritableStream if sink throws an error while closing, the stream becomes errored', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    close() {
      throw thrownError;
    }
  });

  ws.close().then(
    () => t.fail('close promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, thrownError, 'close promise should be rejected with the thrown error');
      t.equal(ws.state, 'errored', 'state is errored after calling close');
    }
  );

  setTimeout(() => {
    t.equal(ws.state, 'errored', 'state stays errored');
  }, 0);
});

test('WritableStream if sink calls error while asynchronously closing, the stream becomes errored', t => {
  t.plan(3);

  var passedError = new Error('error me');
  var error;
  var ws = new WritableStream({
    start(error_) {
      error = error_;
    },
    close() {
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  ws.close();
  setTimeout(() => error(passedError), 10);

  ws.closed.then(
    () => t.fail('closed promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, passedError, 'closed promise should be rejected with the passed error');
      t.equal(ws.state, 'errored', 'state is errored');
    }
  );

  setTimeout(() => {
    t.equal(ws.state, 'errored', 'state stays errored');
  }, 70);
});


test('WritableStream if sink calls error while closing with no asynchrony, the stream becomes errored', t => {
  t.plan(3);

  var passedError = new Error('error me');
  var error;
  var ws = new WritableStream({
    start(error_) {
      error = error_;
    },
    close() {
      error(passedError);
    }
  });

  ws.close().then(
    () => t.fail('close promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, passedError, 'close promise should be rejected with the passed error');
      t.equal(ws.state, 'errored', 'state is errored');
    }
  );

  setTimeout(() => {
    t.equal(ws.state, 'errored', 'state stays errored');
  }, 0);
});

test('WritableStream queue lots of data and have all of them processed at once', t => {
  t.plan(4);

  var numberOfWrites = 10000;

  var resolveFirstWritePromise;
  var writeCount = 0;
  var ws = new WritableStream({
    write(chunk) {
      ++writeCount;
      if (!resolveFirstWritePromise) {
        return new Promise(resolve => resolveFirstWritePromise = resolve);
      }
    }
  });

  setTimeout(() => {
    var writePromise;
    for (var i = 0; i < numberOfWrites; ++i) {
      writePromise = ws.write('a');
    }

    t.strictEqual(ws.state, 'waiting', 'state is waiting since the queue is full of writeRecords');
    t.strictEqual(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    writePromise.then(
      () => {
        t.strictEqual(ws.state, 'writable', 'state is writable again since all writeRecords is done now');
        t.strictEqual(writeCount, numberOfWrites, `should have called sink's write ${numberOfWrites} times`);
      },
      t.ifError
    );
  }, 0);
});
