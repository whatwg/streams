'use strict';
const test = require('tape-catch');

function writeArrayToStream(array, writableStream) {
  array.forEach(chunk => writableStream.write(chunk));
  return writableStream.close();
}

test('Controller argument is given to start method', t => {
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    }
  });

  const writer = ws.getWriter();

  // Now error the stream after its construction.
  const passedError = new Error('horrible things');
  controller.error(passedError);
  t.equal(writer.state, 'errored');
  writer.closed.catch(r => {
    t.equal(r, passedError);
    t.end();
  });
});

test('Underlying sink\'s write won\'t be called until start finishes', t => {
  let expectWriteCall = false;

  let resolveStartPromise;
  const ws = new WritableStream({
    start() {
      return new Promise(resolve => { resolveStartPromise = resolve; });
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

  const writer = ws.getWriter();

  writer.write('a');
  t.equal(writer.state, 'waiting', `writable stream should be waiting, not ${writer.state}`);

  // Wait and see that write won't be called.
  setTimeout(() => {
    expectWriteCall = true;
    resolveStartPromise();
  }, 100);
});

test('Underlying sink\'s close won\'t be called until start finishes', t => {
  let expectCloseCall = false;

  let resolveStartPromise;
  const ws = new WritableStream({
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

  const writer = ws.getWriter();

  writer.close('a');
  t.equal(writer.state, 'closing');

  // Wait and see that write won't be called.
  setTimeout(() => {
    expectCloseCall = true;
    resolveStartPromise();
  }, 100);
});

test('Fulfillment value of ws.close() call must be undefined even if the underlying sink returns a non-undefined ' +
     'value', t => {
  const ws = new WritableStream({
    close() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const closePromise = writer.close('a');
  closePromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('closePromise is rejected');
    t.end();
  });
});

test('Underlying sink\'s write or close are never invoked if start throws', t => {
  const passedError = new Error('horrible things');

  try {
    const ws = new WritableStream({
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
  const ws = new WritableStream({
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

  const ws = new WritableStream();

  const writer = ws.getWriter();

  t.equal(typeof writer.write, 'function', 'has a write method');
  t.equal(typeof writer.abort, 'function', 'has an abort method');
  t.equal(typeof writer.close, 'function', 'has a close method');

  t.equal(writer.state, 'writable', 'state starts out writable');

  t.ok(writer.ready, 'has a ready property');
  t.ok(writer.ready.then, 'ready property is a thenable');
  t.ok(writer.closed, 'has a closed property');
  t.ok(writer.closed.then, 'closed property is thenable');
});

test('WritableStream with simple input, processed asynchronously', t => {
  t.plan(1);

  let storage;
  const ws = new WritableStream({
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

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, writer).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream with simple input, processed synchronously', t => {
  t.plan(1);

  let storage;
  const ws = new WritableStream({
    start() {
      storage = [];
    },

    write(chunk) {
      storage.push(chunk);
    },
  });

  const writer = ws.getWriter();

  const input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, writer).then(
    () => t.deepEqual(storage, input, 'correct data was relayed to underlying sink'),
    r => t.fail(r)
  );
});

test('WritableStream is writable and ready fulfills immediately if the strategy does not apply backpressure', t => {
  const ws = new WritableStream({}, {
    highWaterMark: Infinity,
    size() { return 0; }
  });

  const writer = ws.getWriter();

  t.equal(writer.state, 'writable');

  writer.ready.then(() => {
    t.pass('ready promise was fulfilled');
    t.end();
  });
});

test('Fulfillment value of ws.write() call must be undefined even if the underlying sink returns a non-undefined ' +
     'value', t => {
  const ws = new WritableStream({
    write() {
      return 'Hello';
    }
  });

  const writer = ws.getWriter();

  const writePromise = writer.write('a');
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

  let resolveWritePromise;
  const ws = new WritableStream({
    write() {
      return new Promise(resolve => resolveWritePromise = resolve);
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    t.equal(writer.state, 'writable', 'state starts writable');
    const writePromise = writer.write('a');
    t.equal(writer.state, 'waiting', 'state is waiting until the write finishes');
    resolveWritePromise();
    writePromise.then(() => {
      t.equal(writer.state, 'writable', 'state becomes writable again after the write finishes');
    });
  }, 0);
});

test('WritableStream if write returns a rejected promise, queued write and close are cleared', t => {
  t.plan(6);

  let rejectWritePromise;
  const ws = new WritableStream({
    write() {
      return new Promise((r, reject) => rejectWritePromise = reject);
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    const writePromise = writer.write('a');

    t.notStrictEqual(rejectWritePromise, undefined, 'write is called so rejectWritePromise is set');

    const writePromise2 = writer.write('b');
    const closedPromise = writer.close();

    t.equal(writer.state, 'closing', 'state is closing until the close finishes');

    const passedError = new Error('horrible things');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('writePromise is fulfilled unexpectedly'),
      r => {
        t.equal(r, passedError);
        t.equal(writer.state, 'errored', 'state is errored as the sink called error');

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
  const ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(writer.state, 'writable', 'state must be writable');

    writer.close();
    t.equal(writer.state, 'closing', 'state must become closing synchronously on close call');

    writer.ready.then(v => {
      t.equal(writer.state, 'closed', 'state must be closed by the time ready fulfills (because microtasks ordering)');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready will return a fulfilled promise', t => {
  const ws = new WritableStream({
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    writer.write('a');
    t.equal(writer.state, 'waiting', 'state must become waiting synchronously on write call');

    writer.close();
    t.equal(writer.state, 'closing', 'state must become closing synchronously on close call');

    writer.ready.then(v => {
      t.equal(writer.state, 'closing', 'state must still be closing when ready fulfills');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready will be fulfilled immediately even if close ' +
     'takes a long time', t => {

  let readyFulfilledAlready = false;
  const ws = new WritableStream({
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

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    writer.write('a');
    t.equal(writer.state, 'waiting', 'state must become waiting synchronously on write call');

    writer.close();
    t.equal(writer.state, 'closing', 'state must become closing synchronously on close call');

    writer.ready.then(v => {
      readyFulfilledAlready = true;
      t.equal(writer.state, 'closing', 'state must still be closing when ready fulfills');
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If sink rejects on a WritableStream in writable state, ready will return a fulfilled promise', t => {
  t.plan(5);

  let rejectWritePromise;
  const ws = new WritableStream({
    write() {
      return new Promise((r, reject) => rejectWritePromise = reject);
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    t.equal(writer.state, 'writable', 'state is writable to begin');
    const writePromise = writer.write('a');
    t.equal(writer.state, 'waiting', 'state is waiting after a write');

    const passedError = new Error('pass me');
    rejectWritePromise(passedError);

    writePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');
        t.equal(writer.state, 'errored', 'state is errored as error is called');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('WritableStream if sink\'s close throws', t => {
  const passedError = new Error('pass me');
  const ws = new WritableStream({
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

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    const closedPromise = writer.close();
    t.equal(writer.state, 'closing', 'state must become closing synchronously on close call');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
        t.equal(writer.state, 'errored', 'state must be errored as error is called');
        t.equal(r, passedError, 'close() should be rejected with the passed error');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('WritableStream if the promise returned by sink\'s close rejects', t => {
  const passedError = new Error('pass me');
  const ws = new WritableStream({
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

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    const closedPromise = writer.close();
    t.equal(writer.state, 'closing', 'state must become closing synchronously on close call');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled');
        t.end();
      },
      r => {
        t.equal(writer.state, 'errored', 'state must be errored as error is called');
        t.equal(r, passedError, 'close() should be rejected with the passed error');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('If sink rejects on a WritableStream in waiting state, ready will return a rejected promise', t => {
  t.plan(5);

  const passedError = new Error('pass me');
  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'first chunk succeeds') {
        return new Promise(resolve => setTimeout(resolve, 10));
      }
      return Promise.reject(passedError);
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    writer.write('first chunk succeeds');
    t.equal(writer.state, 'waiting', 'state is waiting after first write');

    const secondWritePromise = writer.write('all other chunks fail');
    t.equal(writer.state, 'waiting', 'state is waiting after a second write');

    secondWritePromise.then(
      () => t.fail('write promise was unexpectedly fulfilled'),
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');
        t.equal(writer.state, 'errored', 'state is errored as error is called');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('WritableStream if sink throws an error inside write, the stream becomes errored and the promise rejects', t => {
  t.plan(3);

  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    write() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  writer.write('a').then(
    () => t.fail('write promise was unexpectedly fulfilled'),
    r => {
      t.equal(r, thrownError, 'write() should reject with the thrown error');
      t.equal(writer.state, 'errored', 'state is errored');

      writer.close().then(
        () => t.fail('close() is fulfilled unexpectedly'),
        r => t.equal(r, thrownError, 'close() should be rejected with the thrown error')
      );
    }
  );
});

test('WritableStream if sink throws an error while closing, the stream becomes errored', t => {
  t.plan(3);

  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    close() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  writer.close().then(
    () => t.fail('close promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, thrownError, 'close promise should be rejected with the thrown error');
      t.equal(writer.state, 'errored', 'state is errored after calling close');
    }
  );

  setTimeout(() => {
    t.equal(writer.state, 'errored', 'state stays errored');
  }, 0);
});

test('WritableStream if sink calls error while asynchronously closing, the stream becomes errored', t => {
  t.plan(3);

  const passedError = new Error('error me');
  let error;
  const ws = new WritableStream({
    start(error_) {
      error = error_;
    },
    close() {
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  const writer = ws.getWriter();

  writer.close();
  setTimeout(() => error(passedError), 10);

  writer.closed.then(
    () => t.fail('closed promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, passedError, 'closed promise should be rejected with the passed error');
      t.equal(writer.state, 'errored', 'state is errored');
    }
  );

  setTimeout(() => {
    t.equal(writer.state, 'errored', 'state stays errored');
  }, 70);
});


test('WritableStream if sink calls error while closing with no asynchrony, the stream becomes errored', t => {
  t.plan(3);

  const passedError = new Error('error me');
  let error;
  const ws = new WritableStream({
    start(error_) {
      error = error_;
    },
    close() {
      error(passedError);
    }
  });

  const writer = ws.getWriter();

  writer.close().then(
    () => t.fail('close promise is fulfilled unexpectedly'),
    r => {
      t.equal(r, passedError, 'close promise should be rejected with the passed error');
      t.equal(writer.state, 'errored', 'state is errored');
    }
  );

  setTimeout(() => {
    t.equal(writer.state, 'errored', 'state stays errored');
  }, 0);
});

test('WritableStream queue lots of data and have all of them processed at once', t => {
  t.plan(4);

  const numberOfWrites = 10000;

  let resolveFirstWritePromise;
  let writeCount = 0;
  const ws = new WritableStream({
    write(chunk) {
      ++writeCount;
      if (!resolveFirstWritePromise) {
        return new Promise(resolve => resolveFirstWritePromise = resolve);
      }
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    let writePromise;
    for (let i = 0; i < numberOfWrites; ++i) {
      writePromise = writer.write('a');
    }

    t.equal(writer.state, 'waiting', 'state is waiting since the queue is full of writeRecords');
    t.equal(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    writePromise.then(
      () => {
        t.equal(writer.state, 'writable', 'state is writable again since all writeRecords is done now');
        t.equal(writeCount, numberOfWrites, `should have called sink's write ${numberOfWrites} times`);
      },
      t.ifError
    );
  }, 0);
});

test('WritableStream should call underlying sink methods as methods', t => {
  t.plan(5);

  class Sink {
    start() {
      // Called twice
      t.equal(this, theSink, 'start() should be called with the correct this');
    }

    write() {
      t.equal(this, theSink, 'pull() should be called with the correct this');
    }

    close() {
      t.equal(this, theSink, 'close() should be called with the correct this');
    }

    abort() {
      t.equal(this, theSink, 'abort() should be called with the correct this');
    }
  }

  const theSink = new Sink();
  theSink.debugName = "the sink object passed to the constructor";
  const ws = new WritableStream(theSink);

  const writer = ws.getWriter();

  writer.write('a');
  writer.close();

  const ws2 = new WritableStream(theSink);
  const writer2 = ws2.getWriter();
  writer2.abort();
});
