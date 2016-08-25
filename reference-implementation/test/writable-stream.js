'use strict';
const test = require('tape-catch');

function promise_rejects(t, expectedReason, promise, name, msg) {
  promise.then(() => {
    t.fail(name + ' fulfilled unexpectedly');
    t.end();
  }, reason => {
    t.equal(reason, expectedReason, msg);
  });
}

function writeArrayToStream(array, writableStreamWriter) {
  array.forEach(chunk => writableStreamWriter.write(chunk));
  return writableStreamWriter.close();
}

test('Controller argument is given to start method', t => {
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    }
  });

  // Now error the stream after its construction.
  const passedError = new Error('horrible things');
  controller.error(passedError);

  const writer = ws.getWriter();

  t.equal(writer.desiredSize, null, 'desiredSize should be null');
  writer.closed.catch(r => {
    t.equal(r, passedError, 'ws should be errored by passedError');
    t.end();
  });
});

test('highWaterMark', t => {
  const ws = new WritableStream({}, {
    highWaterMark: 1000,
    size() { return 1; }
  });

  const writer = ws.getWriter();

  t.equal(writer.desiredSize, 1000, 'desiredSize should be 1000');
  writer.ready.then(v => {
    t.equal(v, undefined, 'ready promise should fulfill with undefined');
    t.end();
  });
});

test('Underlying sink\'s write won\'t be called until start finishes', t => {
  let expectWriteCall = false;

  let resolveStartPromise;
  const ws = new WritableStream({
    start() {
      return new Promise(resolve => {
        resolveStartPromise = resolve;
      });
    },
    write(chunk) {
      if (expectWriteCall) {
        t.equal(chunk, 'a', 'chunk should be the value passed to writer.write()');
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

  t.equal(writer.desiredSize, 1, 'desiredSize should be 1');
  writer.write('a');
  t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after writer.write()');

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
      return new Promise(resolve => {
        resolveStartPromise = resolve;
      });
    },
    write() {
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
  t.equal(writer.desiredSize, 1, 'desiredSize should be 1');

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
    new WritableStream({
      start() {
        throw passedError;
      },
      write() {
        t.fail('Unexpected write call');
        t.end();
      },
      close() {
        t.fail('Unexpected close call');
        t.end();
      }
    });
  } catch (e) {
    t.equal(e, passedError, 'Constructor should throw passedError');
    t.end();
    return;
  }
  t.fail('Constructor didn\'t throw');
  t.end();
});

test('Underlying sink\'s write or close are never invoked if the promise returned by start is rejected', t => {
  new WritableStream({
    start() {
      return Promise.reject();
    },
    write() {
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

  t.equal(writer.desiredSize, 1, 'desiredSize starts out 1');

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
    }
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

  t.equal(writer.desiredSize, Infinity, 'desiredSize should be Infinity');

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
  t.plan(6);

  let resolveSinkWritePromise;
  const ws = new WritableStream({
    write() {
      const sinkWritePromise = new Promise(resolve => {
        resolveSinkWritePromise = resolve;
      });
      return sinkWritePromise;
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    t.equal(writer.desiredSize, 1, 'desiredSize starts 1');

    writer.ready.then(() => {
      const writePromise = writer.write('a');
      t.notEqual(resolveSinkWritePromise, undefined, 'resolveSinkWritePromise should not be undefined');

      t.equal(writer.desiredSize, 0, 'desiredSize should be 0 after writer.write()');

      writePromise.then(value => {
        if (resolveSinkWritePromise !== undefined) {
          t.fail('writePromise fulfilled before sinkWritePromise fulfills');
          t.end();
          return;
        }

        t.equals(value, undefined, 'writePromise should be fulfilled with undefined');
      });

      writer.ready.then(value => {
        if (resolveSinkWritePromise !== undefined) {
          t.fail('writePromise fulfilled before sinkWritePromise fulfills');
          t.end();
          return;
        }

        t.equal(writer.desiredSize, 1, 'desiredSize should be 1 again');

        t.equals(value, undefined, 'writePromise should be fulfilled with undefined');
      });

      setTimeout(() => {
        resolveSinkWritePromise();
        resolveSinkWritePromise = undefined;
      }, 100);
    });
  }, 0);
});

test('WritableStream if write returns a rejected promise, queued write and close are cleared', t => {
  t.plan(9);

  let sinkWritePromiseRejectors = [];
  const ws = new WritableStream({
    write() {
      const sinkWritePromise = new Promise((r, reject) => sinkWritePromiseRejectors.push(reject));
      return sinkWritePromise;
    }
  });

  const writer = ws.getWriter();

  setTimeout(() => {
    t.equals(writer.desiredSize, 1, 'desiredSize should be 1');

    const writePromise = writer.write('a');
    t.equals(sinkWritePromiseRejectors.length, 1, 'There should be 1 rejector');
    t.equals(writer.desiredSize, 0, 'desiredSize should be 0');

    const writePromise2 = writer.write('b');
    t.equals(sinkWritePromiseRejectors.length, 1, 'There should be still 1 rejector');
    t.equals(writer.desiredSize, -1, 'desiredSize should be -1');

    const closedPromise = writer.close();

    t.equals(writer.desiredSize, -1, 'desiredSize should still be -1');

    const passedError = new Error('horrible things');

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
        if (sinkWritePromiseRejectors.length > 0) {
          t.fail('closedPromise rejected before sinkWritePromise rejects');
          t.end();
          return;
        }

        t.equal(r, passedError, 'closedPromise should reject with passedError');
      }
    );

    writePromise.then(
      () => {
        t.fail('writePromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
        if (sinkWritePromiseRejectors.length > 0) {
          t.fail('writePromise2 rejected before sinkWritePromise rejects');
          t.end();
          return;
        }

        t.equal(r, passedError, 'writePromise should reject with passedError');
      }
    );

    writePromise2.then(
      () => {
        t.fail('writePromise2 is fulfilled unexpectedly');
        t.end();
      },
      r => {
        if (sinkWritePromiseRejectors.length > 0) {
          t.fail('writePromise2 rejected before sinkWritePromise rejects');
          t.end();
          return;
        }

        t.equal(r, passedError, 'writePromise2 should reject with passedError');
      }
    );

    setTimeout(() => {
      sinkWritePromiseRejectors[0](passedError);
      sinkWritePromiseRejectors = [];
    }, 100);
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
    writer.ready.then(() => {
      t.equal(writer.desiredSize, 1, 'desiredSize should be 1');

      writer.close();
      t.equal(writer.desiredSize, 1, 'desiredSize should be still 1');

      writer.ready.then(v => {
        t.equal(v, undefined, 'ready promise was fulfilled with undefined');
        t.end();
      });
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready promise will fulfill', t => {
  const ws = new WritableStream({
    write() {
      return new Promise(() => {});
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    writer.write('a');

    t.equal(writer.desiredSize, 0, 'desiredSize should be 0');

    let closeCalled = false;

    writer.ready.then(v => {
      if (closeCalled === false) {
        t.fail('ready fulfilled before writer.close()');
        t.end();
        return;
      }

      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });

    setTimeout(() => {
      writer.close();
      closeCalled = true;
    }, 100);
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

  // Wait for ws to start.
  setTimeout(() => {
    const writer = ws.getWriter();

    writer.write('a');

    writer.close();

    writer.ready.then(v => {
      readyFulfilledAlready = true;
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});

test('If sink rejects on a WritableStream in writable state, ready will return a fulfilled promise', t => {
  let rejectSinkWritePromise;
  const ws = new WritableStream({
    write() {
      return new Promise((r, reject) => {
        rejectSinkWritePromise = reject;
      });
    }
  });

  setTimeout(() => {
    const writer = ws.getWriter();

    const writePromise = writer.write('a');

    const passedError = new Error('pass me');
    rejectSinkWritePromise(passedError);

    writePromise.then(
      () => {
        t.fail('write promise was unexpectedly fulfilled');
        t.end();
      },
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');

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
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    const writer = ws.getWriter();

    const closedPromise = writer.close();

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled unexpectedly');
        t.end();
      },
      r => {
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
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    const writer = ws.getWriter();

    const closedPromise = writer.close();

    closedPromise.then(
      () => {
        t.fail('closedPromise is fulfilled');
        t.end();
      },
      r => {
        t.equal(r, passedError, 'close() should be rejected with the passed error');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('If sink\'s write rejects on a WritableStream in waiting state, ready will return a rejected promise', t => {
  const passedError = new Error('pass me');
  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'first chunk succeeds') {
        return new Promise(resolve => setTimeout(resolve, 10));
      }
      return Promise.reject(passedError);
    }
  });

  setTimeout(() => {
    const writer = ws.getWriter();

    writer.write('first chunk succeeds');

    const secondWritePromise = writer.write('all other chunks fail');

    secondWritePromise.then(
      () => {
        t.fail('write promise was unexpectedly fulfilled');
        t.end();
      },
      r => {
        t.equal(r, passedError, 'write() should be rejected with the passed error');

        writer.ready.then(v => {
          t.equal(v, undefined, 'ready promise was fulfilled with undefined');
          t.end();
        });
      }
    );
  }, 0);
});

test('WritableStream if sink\'s write throws an error inside write, the stream becomes errored and the promise ' +
     'rejects', t => {
  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    write() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  writer.write('a').then(
    () => {
      t.fail('write promise was unexpectedly fulfilled');
      t.end();
    },
    writeE => {
      t.equal(writeE, thrownError, 'write() should reject with the thrown error');

      writer.close().then(
        () => {
          t.fail('close() is fulfilled unexpectedly');
        },
        closeE => {
          t.equal(closeE.constructor, TypeError, 'close() should be rejected');
          t.end();
        }
      );
    }
  );
});

test('WritableStream if sink\'s close throws an error while closing, the stream becomes errored', t => {
  t.plan(2);

  const thrownError = new Error('throw me');
  const ws = new WritableStream({
    close() {
      throw thrownError;
    }
  });

  const writer = ws.getWriter();

  promise_rejects(
      t, thrownError, writer.close(), 'close promise', 'close promise should be rejected with the thrown error');

  setTimeout(() => {
    promise_rejects(t, thrownError, writer.closed, 'closed', 'closed should stay rejected');
  }, 0);
});

test('WritableStream if sink calls error while asynchronously closing, the stream becomes errored', t => {
  t.plan(2);

  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  const writer = ws.getWriter();

  writer.close();
  setTimeout(() => controller.error(passedError), 10);

  promise_rejects(
      t, passedError, writer.closed, 'closed promise', 'closed promise should be rejected with the passed error');

  setTimeout(() => {
    promise_rejects(t, passedError, writer.closed, 'closed', 'closed should stay rejected');
  }, 70);
});


test('WritableStream if sink calls error while closing with no asynchrony, the stream becomes errored', t => {
  t.plan(2);

  const passedError = new Error('error me');
  let controller;
  const ws = new WritableStream({
    start(c) {
      controller = c;
    },
    close() {
      controller.error(passedError);
    }
  });

  const writer = ws.getWriter();

  promise_rejects(
      t, passedError, writer.close(), 'close promise', 'close promise should be rejected with the passed error');

  setTimeout(() => {
    promise_rejects(t, passedError, writer.closed, 'closed', 'closed should stay rejected');
  }, 0);
});

test('WritableStream queue lots of data and have all of them processed at once', t => {
  t.plan(2);

  const numberOfWrites = 10000;

  let resolveFirstWritePromise;
  let writeCount = 0;
  const ws = new WritableStream({
    write() {
      ++writeCount;
      if (!resolveFirstWritePromise) {
        return new Promise(resolve => {
          resolveFirstWritePromise = resolve;
        });
      }
      return Promise.resolve();
    }
  });

  setTimeout(() => {
    const writer = ws.getWriter();

    for (let i = 1; i < numberOfWrites; ++i) {
      writer.write('a');
    }
    const writePromise = writer.write('a');

    t.equal(writeCount, 1, 'should have called sink\'s write once');

    resolveFirstWritePromise();

    writePromise.then(
      () => {
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
  theSink.debugName = 'the sink object passed to the constructor';
  const ws = new WritableStream(theSink);

  const writer = ws.getWriter();

  writer.write('a');
  writer.close();

  const ws2 = new WritableStream(theSink);
  const writer2 = ws2.getWriter();
  writer2.abort();
});
