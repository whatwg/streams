var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import CountQueuingStrategy from '../lib/count-queuing-strategy';
import sequentialReadableStream from './utils/sequential-rs';

test('Piping from a ReadableStream from which lots of data are readable synchronously', t => {
  var rs = new ReadableStream({
    start(enqueue, close) {
      for (var i = 0; i < 1000; ++i) {
        enqueue(i);
      }
      close();
    }
  });
  t.equal(rs.state, 'readable');

  var ws = new WritableStream({
    strategy: new CountQueuingStrategy({
      highWaterMark: 1000
    })
  });
  t.equal(ws.state, 'writable');

  rs.pipeTo(ws);
  t.equal(rs.state, 'closed', 'all data must be read out from rs');
  t.equal(ws.state, 'closing', 'close must have been called after accepting all data from rs');

  t.end();
});

test('Piping from a ReadableStream in readable state to a WritableStream in closing state', t => {
  var pullCount = 0;
  var cancelCalled = false;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue("Hello");
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.assert(!cancelCalled);
      cancelCalled = true;
    }
  });
  t.equal(rs.state, 'readable');

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

  ws.close();
  t.equal(ws.state, 'closing');

  rs.pipeTo(ws);
  t.assert(cancelCalled);
  t.equal(rs.state, 'closed');
  t.end();
});

test('Piping from a ReadableStream in readable state to a WritableStream in errored state', t => {
  var pullCount = 0;
  var cancelCalled = false;
  var passedError = new Error('horrible things');
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue("Hello");
    },
    pull() {
      ++pullCount;
    },
    cancel(reason) {
      t.assert(!cancelCalled, 'cancel must not be called more than once');
      cancelCalled = true;

      t.equal(reason, passedError);
    }
  });
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk) {
      t.assert(!writeCalled, 'write must not be called more than once');
      writeCalled = true;

      t.equal(chunk, 'Hello');

      return Promise.reject(passedError);
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    ws.write('Hello');
    t.assert(writeCalled, 'write must be called');

    ws.ready.then(
      () => t.fail('ready promise unexpectedly fulfilled'),
      () => {
        t.equal(ws.state, 'errored', 'as a result of rejected promise, ws must be in errored state');

        rs.pipeTo(ws);

        // Need to delay because pipeTo retrieves error from dest using ready.
        setTimeout(() => {
          t.assert(cancelCalled);
          t.equal(rs.state, 'closed');
          t.end();
        }, 0);
      });
  }, 0);
});

test('Piping from a ReadableStream in closed state to a WritableStream in writable state', t => {
  var rs = new ReadableStream({
    start(enqueue, close) {
      close();
    },
    pull() {
      t.fail('Unexpected pull call');
      t.end();
    },
    cancel(reason) {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'closed');

  var closeCalled = false;
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      t.assert(!closeCalled);
      closeCalled = true;
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'writable');

    rs.pipeTo(ws);
    t.assert(closeCalled);
    t.equal(ws.state, 'closing');
    t.end();
  }, 0);
});

test('Piping from a ReadableStream in errored state to a WritableStream in writable state', t => {
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      error();
    },
    pull() {
      t.fail('Unexpected pull call');
      t.end();
    },
    cancel(reason) {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'errored');

  var abortCalled = false;
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.assert(!abortCalled);
      abortCalled = true;
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'writable');

    rs.pipeTo(ws);

    // Need to delay because pipeTo retrieves error from dest using ready.
    setTimeout(() => {
      t.assert(abortCalled);
      t.equal(ws.state, 'errored');
      t.end();
    }, 0);
  }, 0);
});

test('Piping from a ReadableStream in readable state which becomes closed after pipeTo call to a WritableStream in ' +
    'writable state', t => {
  var closeReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('Hello');
      closeReadableStream = close;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
        t.end();
      }
    },
    close() {
      t.assert(writeCalled);
      t.equal(pullCount, 1);

      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    rs.pipeTo(ws);
    t.equal(rs.state, 'waiting', 'value must leave readable state synchronously');
    t.equal(ws.state, 'waiting', 'writable stream must be written to, entering a waiting state');

    closeReadableStream();
  }, 0);
});

test('Piping from a ReadableStream in readable state which becomes errored after pipeTo call to a WritableStream in ' +
    'writable state', t => {
  var errorReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      enqueue("Hello");
      errorReadableStream = error;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var passedError = new Error('horrible things');
  var ws = new WritableStream({
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
        t.end();
      }
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.equal(reason, passedError);
      t.assert(writeCalled);
      t.equal(pullCount, 1);

      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    rs.pipeTo(ws);
    t.equal(rs.state, 'waiting', 'value must leave readable state synchronously');
    t.equal(ws.state, 'waiting', 'writable stream must be written to, entering a waiting state');

    errorReadableStream(passedError);
  }, 0);
});

test('Piping from a ReadableStream in waiting state which becomes readable after pipeTo call to a WritableStream in ' +
    'writable state', t => {
  var enqueue;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var ws = new WritableStream({
    write(chunk) {
      t.equal(chunk, 'Hello');
      t.equal(pullCount, 1);
      t.end();
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  rs.pipeTo(ws);
  t.equal(rs.state, 'waiting');
  t.equal(ws.state, 'writable');

  enqueue('Hello');
});

test('Piping from a ReadableStream in waiting state which becomes errored after pipeTo call to a WritableStream in ' +
    'writable state', t => {
  var errorReadableStream;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      errorReadableStream = error;
    },
    pull() {
      t.fail('Unexpected pull call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var passedError = new Error('horrible things');
  var ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.equal(reason, passedError);
      t.end();
    }
  });

  rs.pipeTo(ws);
  t.equal(rs.state, 'waiting');
  t.equal(ws.state, 'writable');

  errorReadableStream(passedError);
  t.equal(rs.state, 'errored');
});

test('Piping from a ReadableStream in waiting state to a WritableStream in writable state which becomes errored ' +
    'after pipeTo call', t => {
  var writeCalled = false;

  var pullCount = 0;
  var rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel() {
      t.equal(pullCount, 1, 'pull should have been called once by cancel-time');
      t.assert(writeCalled, 'write should have been called by cancel-time');
      t.end();
    }
  });

  var errorWritableStream;
  var ws = new WritableStream({
    start(error) {
      errorWritableStream = error;
    },
    write(chunk) {
      t.assert(!writeCalled, 'write should not have been called more than once');
      writeCalled = true;

      t.equal(chunk, 'Hello', 'the chunk passed to write should be the one written');
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  // Needed to prepare errorWritableStream
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'writable', 'ws should start writable');

    rs.pipeTo(ws);
    t.equal(rs.state, 'waiting', 'rs should be waiting after pipe');
    t.equal(ws.state, 'writable', 'ws should be writable after pipe');

    errorWritableStream();
    t.equal(ws.state, 'errored', 'ws should be errored after erroring it');
  }, 0);
});

test('Piping from a ReadableStream in readable state to a WritableStream in waiting state which becomes writable ' +
    'after pipeTo call', t => {
  var enqueue;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue) {
      enqueue('World');
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var resolveWritePromise;
  var ws = new WritableStream({
    write(chunk) {
      if (!resolveWritePromise) {
        t.equal(chunk, 'Hello');
        return new Promise(resolve => resolveWritePromise = resolve);
      } else {
        t.equal(chunk, 'World');

        t.equal(pullCount, 1);

        t.end();
      }
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    resolveWritePromise();
    ws.ready.then(() => {
      t.equal(ws.state, 'writable');
    })
    .catch(t.error);
  }, 0);
});

test('Piping from a ReadableStream in readable state to a WritableStream in waiting state which becomes errored ' +
    'after pipeTo call', t => {
  var writeCalled = false;

  var enqueue;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue) {
      enqueue('World');
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.assert(writeCalled);
      t.equal(pullCount, 1);
      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var errorWritableStream;
  var ws = new WritableStream({
    start(error) {
      errorWritableStream = error;
    },
    write(chunk) {
      t.assert(!writeCalled);
      t.equal(chunk, 'Hello');
      writeCalled = true;
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    errorWritableStream();
    t.equal(ws.state, 'errored');
  }, 0);
});

test('Piping from a ReadableStream in readable state which becomes errored after pipeTo call to a WritableStream in ' +
    'waiting state', t => {
  var errorReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      enqueue('World');
      errorReadableStream = error;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk) {
      t.assert(!writeCalled);
      writeCalled = true;

      t.equal(chunk, 'Hello');

      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort() {
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');
    t.equal(pullCount, 1);

    rs.pipeTo(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    errorReadableStream();
    t.equal(rs.state, 'errored');
  }, 0);
});

test('Piping from a ReadableStream in waiting state to a WritableStream in waiting state where both become ready ' +
    'after pipeTo', t => {
  var enqueue;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var checkSecondWrite = false;

  var resolveWritePromise;
  var ws = new WritableStream({
    write(chunk) {
      if (checkSecondWrite) {
        t.equal(chunk, 'Goodbye');
        t.end();
      } else {
        t.assert(!resolveWritePromise);
        t.equal(chunk, 'Hello');
        return new Promise(resolve => resolveWritePromise = resolve);
      }
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.assert(resolveWritePromise);
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);

    enqueue('Goodbye');

    // Check that nothing happens before calling done(), and then call done()
    // to check that pipeTo is woken up.
    setTimeout(() => {
      t.equal(pullCount, 1);

      checkSecondWrite = true;

      resolveWritePromise();
    }, 100);
  }, 0);
});

test('Piping from a ReadableStream in waiting state to a WritableStream in waiting state which becomes writable ' +
    'after pipeTo call', t => {
  var pullCount = 0;
  var rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var resolveWritePromise;
  var ws = new WritableStream({
    write(chunk) {
      t.assert(!resolveWritePromise);
      t.equal(chunk, 'Hello');
      return new Promise(resolve => resolveWritePromise = resolve);
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(rs.state, 'waiting');
    t.equal(ws.state, 'waiting');

    resolveWritePromise();
    // Check that nothing happens.
    setTimeout(() => {
      t.equal(pullCount, 1);

      t.end();
    }, 100);
  }, 0);
});

test('Piping from a ReadableStream in waiting state which becomes closed after pipeTo call to a WritableStream in ' +
    'waiting state', t => {
  var closeReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close) {
      closeReadableStream = close;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
        t.end();
      }
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.fail('Unexpected abort call');
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);

    closeReadableStream();
    t.equal(rs.state, 'closed');
    // Check that nothing happens.
    setTimeout(() => {
      t.equal(ws.state, 'closing');

      t.equal(pullCount, 1);

      t.end();
    }, 100);
  });
});

test('Piping from a ReadableStream in waiting state which becomes errored after pipeTo call to a WritableStream in ' +
    'waiting state', t => {
  var errorReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      errorReadableStream = error;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var writeCalled = false;
  var passedError = new Error('horrible things');
  var ws = new WritableStream({
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
        t.end();
      }
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.equal(reason, passedError);
      t.assert(writeCalled);
      t.equal(pullCount, 1);
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);

    errorReadableStream(passedError);
    t.equal(rs.state, 'errored');
  });
});

test('Piping to a duck-typed asynchronous "writable stream" works', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var rs = sequentialReadableStream(5, { async: true });

  var chunksWritten = [];
  var dest = {
    state: 'writable',
    write(chunk) {
      chunksWritten.push(chunk);
      return Promise.resolve();
    },
    get ready() {
      return Promise.resolve();
    },
    close() {
      t.deepEqual(chunksWritten, [1, 2, 3, 4, 5]);
      return Promise.resolve();
    },
    abort() {
      t.fail('Should not call abort');
    },
    closed: new Promise(() => {})
  };

  rs.pipeTo(dest);
});

test('Piping to a stream that has been aborted passes through the error as the cancellation reason', t => {
  var recordedReason;
  var rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var ws = new WritableStream();
  var passedReason = new Error('I don\'t like you.');
  ws.abort(passedReason);

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(recordedReason, passedReason, 'the recorded cancellation reason must be the passed abort reason');
    t.end();
  }, 10);
});

test('Piping to a stream and then aborting it passes through the error as the cancellation reason', t => {
  var recordedReason;
  var rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var ws = new WritableStream();
  var passedReason = new Error('I don\'t like you.');

  rs.pipeTo(ws);
  ws.abort(passedReason);

  setTimeout(() => {
    t.equal(recordedReason, passedReason, 'the recorded cancellation reason must be the passed abort reason');
    t.end();
  }, 10);
});

test('Piping to a stream that has been closed propagates a TypeError cancellation reason backward', t => {
  var recordedReason;
  var rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var ws = new WritableStream();
  ws.close();

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(recordedReason.constructor, TypeError, 'the recorded cancellation reason must be a TypeError');
    t.end();
  }, 10);
});

test('Piping to a stream and then closing it propagates a TypeError cancellation reason backward', t => {
  var recordedReason;
  var rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var ws = new WritableStream();

  rs.pipeTo(ws);
  ws.close();

  setTimeout(() => {
    t.equal(recordedReason.constructor, TypeError, 'the recorded cancellation reason must be a TypeError');
    t.end();
  }, 10);
});

test('Piping to a stream that synchronously errors passes through the error as the cancellation reason', t => {
  var recordedReason;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      close();
    },
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var written = 0;
  var passedError = new Error('I don\'t like you.');
  var ws = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (++written > 1) {
          reject(passedError);
        } else {
          resolve();
        }
      });
    }
  });

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(recordedReason, passedError, 'the recorded cancellation reason must be the passed error');
    t.end();
  }, 10);
});

test('Piping to a stream that asynchronously errors passes through the error as the cancellation reason', t => {
  var recordedReason;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      close();
    },
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var written = 0;
  var passedError = new Error('I don\'t like you.');
  var ws = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (++written > 1) {
          setTimeout(() => reject(passedError), 10);
        } else {
          resolve();
        }
      });
    }
  });

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(recordedReason, passedError, 'the recorded cancellation reason must be the passed error');
    t.end();
  }, 20);
});

test('Piping to a stream that errors on the last chunk passes through the error to a non-closed producer', t => {
  var recordedReason;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      setTimeout(close, 10);
    },
    cancel(reason) {
      recordedReason = reason;
    }
  });

  var written = 0;
  var passedError = new Error('I don\'t like you.');
  var ws = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (++written > 1) {
          reject(passedError);
        } else {
          resolve();
        }
      });
    }
  });

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(recordedReason, passedError, 'the recorded cancellation reason must be the passed error');
    t.end();
  }, 20);
});

test('Piping to a stream that errors on the last chunk does not pass through the error to a closed producer', t => {
  var cancelCalled = false;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      close();
    },
    cancel() {
      cancelCalled = true;
    }
  });

  var written = 0;
  var ws = new WritableStream({
    write(chunk) {
      return new Promise((resolve, reject) => {
        if (++written > 1) {
          reject(new Error('producer will not see this'));
        } else {
          resolve();
        }
      });
    }
  });

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(cancelCalled, false, 'cancel must not be called');
    t.equal(ws.state, 'errored', 'the writable stream must still be in an errored state');
    t.end();
  }, 20);
});

test('Piping to a writable stream that does not consume the writes fast enough exerts backpressure on the source', t => {
  t.plan(2);

  var enqueueReturnValues = [];
  var rs = new ReadableStream({
    start(enqueue, close) {
      setTimeout(() => enqueueReturnValues.push(enqueue('a')), 10);
      setTimeout(() => enqueueReturnValues.push(enqueue('b')), 20);
      setTimeout(() => enqueueReturnValues.push(enqueue('c')), 30);
      setTimeout(() => enqueueReturnValues.push(enqueue('d')), 40);
      setTimeout(() => close(), 50);
    }
  });

  var writtenValues = [];
  var ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => {
        setTimeout(() => {
          writtenValues.push(chunk);
          resolve();
        }, 25);
      });
    }
  });

  setTimeout(() => {
    rs.pipeTo(ws).then(() => {
      t.deepEqual(enqueueReturnValues, [true, true, false, false], 'backpressure was correctly exerted at the source');
      t.deepEqual(writtenValues, ['a', 'b', 'c', 'd'], 'all chunks were written');
    });
  }, 0);
});
