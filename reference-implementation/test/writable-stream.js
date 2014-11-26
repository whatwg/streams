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
    t.equal(r, passedError);
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

test('Fulfillment value of ws.close() call must be undefined even if the underlying sink returns a non-undefined ' +
     'value', t => {
  var ws = new WritableStream({
    close() {
      return 'Hello';
    }
  });

  var closePromise = ws.close('a');
  closePromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('closePromise is rejected');
    t.end();
  });
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
    t.equal(e, passedError);
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
  t.plan(8);

  var ws = new WritableStream();

  t.equal(typeof ws.write, 'function', 'has a write method');
  t.equal(typeof ws.abort, 'function', 'has an abort method');
  t.equal(typeof ws.close, 'function', 'has a close method');

  t.equal(ws.state, 'writable', 'state starts out writable');

  t.ok(ws.ready, 'has a ready property');
  t.ok(ws.ready.then, 'ready property is a thenable');
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

test('WritableStream is writable and ready fulfills immediately if the strategy does not apply backpressure', t => {
  var ws = new WritableStream({
    strategy: { shouldApplyBackpressure() { return false; } }
  });

  t.equal(ws.state, 'writable');

  ws.ready.then(() => {
    t.pass('ready promise was fulfilled');
    t.end();
  });
});

test('WritableStream is waiting and ready does not fulfill immediately if the stream is applying backpressure', t => {
  var ws = new WritableStream({
    strategy: { shouldApplyBackpressure() { return true; } }
  });

  t.equal(ws.state, 'waiting');

  ws.ready.then(() => {
    t.fail('ready promise was fulfilled');
    t.end();
  });

  setTimeout(() => {
    t.pass('ready promise was left pending');
    t.end();
  }, 30);
});

test('Fulfillment value of ws.write() call must be undefined even if the underlying sink returns a non-undefined ' +
     'value', t => {
  var ws = new WritableStream({
    write() {
      return 'Hello';
    }
  });

  var writePromise = ws.write('a');
  writePromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('writePromise is rejected');
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
    t.equal(ws.state, 'writable', 'state starts writable');
    var writePromise = ws.write('a');
    t.equal(ws.state, 'waiting', 'state is waiting until the write finishes');
    resolveWritePromise();
    writePromise.then(() => {
      t.equal(ws.state, 'writable', 'state becomes writable again after the write finishes');
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

    t.equal(ws.state, 'closing', 'state is closing until the close finishes');

    var passedError = new Error('horrible things');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('writePromise is fulfilled unexpectedly'),
      r => {
        t.equal(r, passedError);
        t.equal(ws.state, 'errored', 'state is errored as the sink called error');

        writePromise2.then(
          () => t.fail('writePromise2 is fulfilled unexpectedly'),
          r => t.equal(r, passedError)
        );

        closedPromise.then(
          () => t.fail('closedPromise is fulfilled unexpectedly'),
          r => t.equal(r, passedError)
        );
      }
    );
  }, 0);
});

test('If close is called on a WritableStream in writable state, ready will return a fulfilled promise', t => {
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'writable', 'state must be writable');

    ws.close();
    t.equal(ws.state, 'closing', 'state must become closing synchronously on close call');

    ws.ready.then(v => {
      t.equal(ws.state, 'closed', 'state must be closed by the time ready fulfills (because microtasks ordering)');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready will return a fulfilled promise', t => {
  var ws = new WritableStream({
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    ws.write('a');
    t.equal(ws.state, 'waiting', 'state must become waiting synchronously on write call');

    ws.close();
    t.equal(ws.state, 'closing', 'state must become closing synchronously on close call');

    ws.ready.then(v => {
      t.equal(ws.state, 'closing', 'state must still be closing when ready fulfills');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready will be fulfilled immediately even if close ' +
     'takes a long time', t => {

  var readyFulfilledAlready = false;
  var ws = new WritableStream({
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    },
    close() {
      return new Promise(resolve => {
        setTimeout(() => {
          t.ok(readyFulfilledAlready, 'ready should have fulfilled already');
          resolve();
        }, 50);
      });
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    ws.write('a');
    t.equal(ws.state, 'waiting', 'state must become waiting synchronously on write call');

    ws.close();
    t.equal(ws.state, 'closing', 'state must become closing synchronously on close call');

    ws.ready.then(v => {
      readyFulfilledAlready = true;
      t.equal(ws.state, 'closing', 'state must still be closing when ready fulfills');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If sink rejects on a WritableStream in writable state, ready will return a fulfilled promise', t => {
  t.plan(5);

  var rejectWritePromise;
  var ws = new WritableStream({
    write() {
      return new Promise((r, reject) => rejectWritePromise = reject);
    }
  });

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'state is writable to begin');
    var writePromise = ws.write('a');
    t.equal(ws.state, 'waiting', 'state is waiting after a write');

    var passedError = new Error('pass me');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');
        t.equal(ws.state, 'errored', 'state is errored as error is called');

        ws.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
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
    t.equal(ws.state, 'closing', 'state must become closing synchronously on close call');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
        t.equal(ws.state, 'errored', 'state must be errored as error is called');
        t.equal(r, passedError, 'close() should be rejected with the passed error');

        ws.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('WritableStream if the promise returned by sink\'s close rejects', t => {
  var passedError = new Error('pass me');
  var ws = new WritableStream({
    write() {
      t.fail('write of sink called');
      t.end();
    },
    close() {
      return Promise.reject(passedError);
    },
    abort() {
      t.fail('abort of sink called');
      t.end();
    },
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closedPromise = ws.close();
    t.equal(ws.state, 'closing', 'state must become closing synchronously on close call');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled');
        t.end();
      },
      r => {
        t.equal(ws.state, 'errored', 'state must be errored as error is called');
        t.equal(r, passedError, 'close() should be rejected with the passed error');

        ws.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('If sink rejects on a WritableStream in waiting state, ready will return a rejected promise', t => {
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
    t.equal(ws.state, 'waiting', 'state is waiting after first write');

    var secondWritePromise = ws.write('all other chunks fail');
    t.equal(ws.state, 'waiting', 'state is waiting after a second write');

    secondWritePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');
        t.equal(ws.state, 'errored', 'state is errored as error is called');

        ws.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
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
      t.equal(r, thrownError, 'write() should reject with the thrown error');
      t.equal(ws.state, 'errored', 'state is errored');

      ws.close().then(
        () => t.fail('close() is fulfilled unexpectedly'),
        r => t.equal(r, thrownError, 'close() should be rejected with the thrown error')
      );
    }
  );
});

test('WritableStream exception in shouldApplyBackpressure during write moves the stream into errored state', t => {
  t.plan(3);

  var aboutToWrite = false;
  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        if (aboutToWrite) {
          throw thrownError;
        }
      }
    }
  });

  aboutToWrite = true;
  ws.write('a').catch(r => {
    t.equal(r, thrownError);
  });

  t.equal(ws.state, 'errored', 'the state of ws must be errored as shouldApplyBackpressure threw');
  ws.closed.catch(r => {
    t.equal(r, thrownError);
  });
});

test('WritableStream exception in size during write moves the stream into errored state', t => {
  t.plan(3);

  var thrownError = new Error('throw me');
  var ws = new WritableStream({
    strategy: {
      size() {
        throw thrownError;
      },
      shouldApplyBackpressure() {
        return false;
      }
    }
  });
  ws.write('a').catch(r => {
    t.equal(r, thrownError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as size threw');
  ws.closed.catch(r => {
    t.equal(r, thrownError);
  });
});

test('WritableStream NaN size during write moves the stream into errored state', t => {
  t.plan(3);

  var ws = new WritableStream({
    strategy: {
      size() {
        return NaN;
      },
      shouldApplyBackpressure() {
        return false;
      }
    }
  });
  ws.write('a').catch(r => {
    t.equal(r.constructor, RangeError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as an invalid size was returned');
  ws.closed.catch(r => {
    t.equal(r.constructor, RangeError);
  });
});

test('WritableStream +Infinity size during write moves the stream into errored state', t => {
  t.plan(3);

  var ws = new WritableStream({
    strategy: {
      size() {
        return +Infinity;
      },
      shouldApplyBackpressure() {
        return false;
      }
    }
  });
  ws.write('a').catch(r => {
    t.equal(r.constructor, RangeError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as an invalid size was returned');
  ws.closed.catch(r => {
    t.equal(r.constructor, RangeError);
  });
});

test('WritableStream -Infinity size during write moves the stream into errored state', t => {
  t.plan(3);

  var ws = new WritableStream({
    strategy: {
      size() {
        return -Infinity;
      },
      shouldApplyBackpressure() {
        return false;
      }
    }
  });
  ws.write('a').catch(r => {
    t.equal(r.constructor, RangeError);
  });
  t.equal(ws.state, 'errored', 'the state of ws must be errored as an invalid size was returned');
  ws.closed.catch(r => {
    t.equal(r.constructor, RangeError);
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
        t.equal(r, thrownError);
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

    t.equal(ws.state, 'waiting', 'state is waiting since the queue is full of writeRecords');
    t.equal(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    writePromise.then(
      () => {
        t.equal(ws.state, 'writable', 'state is writable again since all writeRecords is done now');
        t.equal(writeCount, numberOfWrites, `should have called sink's write ${numberOfWrites} times`);
      },
      t.ifError
    );
  }, 0);
});
