'use strict';
const test = require('tape-catch');

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
