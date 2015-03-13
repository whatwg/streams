const test = require('tape-catch');

import sequentialReadableStream from './utils/sequential-rs';

// TODO: many asserts in this file are unlabeled; we should label them.

test('Piping from a ReadableStream from which lots of data are readable synchronously', t => {
  t.plan(4);

  const rs = new ReadableStream({
    start(enqueue, close) {
      for (let i = 0; i < 1000; ++i) {
        enqueue(i);
      }
      close();
    }
  });

  const ws = new WritableStream({
    strategy: new CountQueuingStrategy({
      highWaterMark: 1000
    })
  });

  t.equal(ws.state, 'writable', 'writable stream state should start out writable');

  let rsClosed = false;
  rs.closed.then(() => {
    rsClosed = true;
  });

  let pipeFinished = false;
  rs.pipeTo(ws).finished.then(
    () => {
      pipeFinished = true;
      t.equal(rsClosed, true, 'readable stream should be closed after pipe finishes');
      t.equal(ws.state, 'closed', 'writable stream state should be closed after pipe finishes');
    },
    e => t.error(e)
  );

  setTimeout(() => {
    t.equal(pipeFinished, true, 'pipe should have finished before a setTimeout(,0) since it should only be microtasks');
  }, 0);
});

test('Piping from a ReadableStream in readable state to a WritableStream in closing state', t => {
  t.plan(4);

  let cancelReason;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('Hello');
    },
    cancel(reason) {
      t.equal(reason.constructor, TypeError, 'underlying source cancel should have been called with a TypeError');
      cancelReason = reason;
    }
  });

  const ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  ws.close();
  t.equal(ws.state, 'closing', 'writable stream should be closing immediately after closing it');

  let rsClosed = false;
  rs.closed.then(() => {
    rsClosed = true;
  });

  rs.pipeTo(ws).finished.then(
    () => t.fail('pipeTo finished promise should not fulfill'),
    r => {
      t.equal(r, cancelReason,
        'pipeTo finished promise should reject with the same error as the underlying source cancel was called with');
      t.equal(rsClosed, true, 'readable stream should be closed after pipe finishes');
    }
  );
});

test('Piping from a ReadableStream in readable state to a WritableStream in errored state', t => {
  let pullCount = 0;
  let cancelCalled = false;
  const passedError = new Error('horrible things');
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('Hello');
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

  let writeCalled = false;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
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

  startPromise.then(() => {
    ws.write('Hello');
    t.assert(writeCalled, 'write must be called');

    ws.ready.then(() => {
      t.equal(ws.state, 'errored', 'as a result of rejected promise, ws must be in errored state');

      rs.pipeTo(ws).finished.catch(e => {
        t.equal(e, passedError, 'pipeTo finished promise should be rejected with the error');
        t.assert(cancelCalled, 'cancel should have been called');
        t.end();
      });
    });
  });
});

test('Piping from a ReadableStream in the readable state which becomes closed after pipeTo call to a WritableStream ' +
     'in the writable state', t => {
  t.plan(5);

  let closeReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('Hello');
      closeReadableStream = close;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let writeCalled = false;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello', 'chunk written to writable stream should be the one enqueued into the readable stream');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
      }
    },
    close() {
      t.pass('underlying sink close should be called');
      t.equal(pullCount, 1, 'underlying source pull should have been called once');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  startPromise.then(() => {
    rs.pipeTo(ws).finished.then(() => {
      t.equal(ws.state, 'closed', 'writable stream should be closed after pipeTo finishes');
    });

    t.equal(ws.state, 'writable', 'writable stream should still be writable immediately after pipeTo call');

    closeReadableStream();
  });
});

test('Piping from a ReadableStream in the readable state which becomes errored after pipeTo call to a WritableStream ' +
     'in the writable state', t => {
  t.plan(5);

  let errorReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      enqueue('Hello');
      errorReadableStream = error;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let passedError = new Error('horrible things');
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      t.fail('Unexpected extra write call');
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort(reason) {
      t.equal(reason, passedError, 'underlying sink abort should receive the error from the readable stream');
      t.equal(pullCount, 1, 'underlying source pull should have been called once');
    }
  });

  startPromise.then(() => {
    rs.pipeTo(ws).finished.catch(e => {
      t.equal(e, passedError, 'pipeTo finished promise should be rejected with the passed error');
      t.equal(ws.state, 'errored', 'writable stream should be errored after pipeTo finishes');
    });

    t.equal(ws.state, 'writable', 'writable stream should still be writable immediately after pipeTo call');

    errorReadableStream(passedError);
  });
});

test('Piping from an empty ReadableStream which becomes non-empty after pipeTo call to a WritableStream in the ' +
     'writable state', t => {
  t.plan(3);
  let enqueue;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  const ws = new WritableStream({
    write(chunk) {
      t.equal(chunk, 'Hello', 'underlying sink write should be called with the single chunk');
      t.equal(pullCount, 1, 'pull should have been called once');
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort(reason) {
      t.fail('Unexpected abort call');
    }
  });

  rs.pipeTo(ws).finished.then(() => t.fail('pipeTo finished promise should not fulfill'));
  t.equal(ws.state, 'writable', 'writable stream should start in writable state');

  enqueue('Hello');
});

test('Piping from an empty ReadableStream which becomes errored after pipeTo call to a WritableStream in the ' +
    'writable state', t => {
  t.plan(3);

  let errorReadableStream;
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      errorReadableStream = error;
    },
    pull() {
      t.fail('Unexpected pull call');
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  const passedError = new Error('horrible things');
  const ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort(reason) {
      t.equal(reason, passedError, 'underlying sink abort should receive the error from the readable stream');
    }
  });

  rs.pipeTo(ws).finished.catch(
    e => t.equal(e, passedError, 'pipeTo finished promise should reject with the passed error')
  );
  t.equal(ws.state, 'writable', 'writable stream should start out writable');
  errorReadableStream(passedError);
});

test('Piping from an empty ReadableStream to a WritableStream in the writable state which becomes errored after a ' +
     'pipeTo call', t => {
  t.plan(6);

  const theError = new Error('cancel with me!');

  let pullCount = 0;
  const rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel(reason) {
      t.equal(reason, theError, 'underlying source cancellation reason should be the writable stream error');
      t.equal(pullCount, 1, 'pull should have been called once by cancel-time');
    }
  });

  let errorWritableStream;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start(error) {
      errorWritableStream = error;
      return startPromise;
    },
    write(chunk) {
      t.fail('Unexpected write call');
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  startPromise.then(() => {
    t.equal(ws.state, 'writable', 'ws should start writable');

    rs.pipeTo(ws).finished.catch(
      e => t.equal(e, theError, 'pipeTo finished promise should reject with the passed error')
    );
    t.equal(ws.state, 'writable', 'ws should be writable after pipe');

    errorWritableStream(theError);
    t.equal(ws.state, 'errored', 'ws should be errored after erroring it');
  });
});

test('Piping from a non-empty ReadableStream to a WritableStream in the waiting state which becomes writable after a ' +
     'pipeTo call', t => {
  let enqueue;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('World');
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let resolveWritePromise;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      if (!resolveWritePromise) {
        t.equal(chunk, 'Hello');
        return new Promise(resolve => resolveWritePromise = resolve);
      } else {
        t.equal(chunk, 'World');
        t.equal(pullCount, 2);
        t.end();
      }
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(ws.state, 'waiting');

    resolveWritePromise();
    ws.ready.then(() => {
      t.equal(ws.state, 'writable');
    })
    .catch(e => t.error(e));
  });
});

test('Piping from a non-empty ReadableStream to a WritableStream in waiting state which becomes errored after a ' +
     'pipeTo call', t => {
  let writeCalled = false;

  let enqueue;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('World');
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.assert(writeCalled);
      t.equal(pullCount, 2);
      t.end();
    }
  });

  let errorWritableStream;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start(error) {
      errorWritableStream = error;
      return startPromise;
    },
    write(chunk) {
      t.assert(!writeCalled);
      t.equal(chunk, 'Hello');
      writeCalled = true;
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(ws.state, 'waiting');

    errorWritableStream();
    t.equal(ws.state, 'errored');
  });
});

test('Piping from a non-empty ReadableStream which becomes errored after pipeTo call to a WritableStream in the ' +
     'waiting state', t => {
  t.plan(6);

  let errorReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
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

  let writeCalled = false;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      t.assert(!writeCalled);
      writeCalled = true;

      t.equal(chunk, 'Hello');

      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.pass('underlying source abort was called');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting');
    t.equal(pullCount, 1);

    rs.pipeTo(ws);
    t.equal(ws.state, 'waiting');

    errorReadableStream();
  });
});

test('Piping from a non-empty ReadableStream to a WritableStream in the waiting state where both become ready ' +
     'after a pipeTo', t => {
  let enqueue;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue_) {
      enqueue = enqueue_;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let checkSecondWrite = false;

  let resolveWritePromise;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
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
    },
    abort(reason) {
      t.fail('Unexpected abort call');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.assert(resolveWritePromise);
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);

    enqueue('Goodbye');

    // Check that nothing happens before calling done(), and then call done()
    // to check that pipeTo is woken up.
    setTimeout(() => {
      t.equal(pullCount, 2);

      checkSecondWrite = true;

      resolveWritePromise();
    }, 100);
  });
});

test('Piping from an empty ReadableStream to a WritableStream in the waiting state which becomes writable after a ' +
     'pipeTo call', t => {
  let pullCount = 0;
  const rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  let resolveWritePromise;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      t.assert(!resolveWritePromise);
      t.equal(chunk, 'Hello');
      return new Promise(resolve => resolveWritePromise = resolve);
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);
    t.equal(ws.state, 'waiting');
    t.equal(pullCount, 1);

    resolveWritePromise();
    setTimeout(() => {
      t.equal(pullCount, 1);

      t.end();
    }, 100);
  });
});

test('Piping from an empty ReadableStream which becomes closed after a pipeTo call to a WritableStream in the ' +
     'waiting state whose writes never complete', t => {
  t.plan(4);

  let closeReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue, close) {
      closeReadableStream = close;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let writeCalled = false;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello', 'the chunk should be written to the writable stream');
        writeCalled = true;
        closeReadableStream();
      } else {
        t.fail('Unexpected extra write call');
      }
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting', 'the writable stream should be in the waiting state after starting');

    rs.pipeTo(ws);

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'the writable stream should still be waiting since the write never completed');
      t.equal(pullCount, 1, 'pull should have been called only once');
    }, 50);
  });
});

test('Piping from an empty ReadableStream which becomes errored after a pipeTo call to a WritableStream in the ' +
     'waiting state', t => {
  t.plan(5);

  let errorReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      errorReadableStream = error;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let writeCalled = false;
  const passedError = new Error('horrible things');
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
      }
      return new Promise(() => {});
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort(reason) {
      t.equal(reason, passedError);
      t.assert(writeCalled);
      t.equal(pullCount, 1);
    }
  });
  ws.write('Hello');

  startPromise.then(() => {
    t.equal(ws.state, 'waiting');

    rs.pipeTo(ws);

    errorReadableStream(passedError);
  });
});

test('Piping to a duck-typed asynchronous "writable stream" works', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  const rs = sequentialReadableStream(5, { async: true });

  const chunksWritten = [];
  const dest = {
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
  let recordedReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  const ws = new WritableStream();
  const passedReason = new Error('I don\'t like you.');
  ws.abort(passedReason);

  rs.pipeTo(ws).finished.catch(e => {
    t.equal(e, passedReason, 'pipeTo finished promise should reject with the cancellation reason');
    t.equal(recordedReason, passedReason, 'the recorded cancellation reason should be the passed abort reason');
    t.end();
  });
});

test('Piping to a stream and then aborting it passes through the error as the cancellation reason', t => {
  let recordedReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  const ws = new WritableStream();
  const passedReason = new Error('I don\'t like you.');

  const pipeToPromise = rs.pipeTo(ws);
  ws.abort(passedReason);

  pipeToPromise.finished.catch(e => {
    t.equal(e, passedReason, 'pipeTo finished promise should reject with the abortion reason');
    t.equal(recordedReason, passedReason, 'the recorded cancellation reason should be the passed abort reason');
    t.end();
  });
});

test('Piping to a stream that has been closed propagates a TypeError cancellation reason backward', t => {
  let recordedReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  const ws = new WritableStream();
  ws.close();

  rs.pipeTo(ws).finished.catch(e => {
    t.equal(e.constructor, TypeError, 'pipeTo finished promise should reject with a TypeError');
    t.equal(recordedReason.constructor, TypeError, 'the recorded cancellation reason should be a TypeError');
    t.end();
  });
});

test('Piping to a stream and then closing it propagates a TypeError cancellation reason backward', t => {
  let recordedReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  const ws = new WritableStream();

  const pipeToPromise = rs.pipeTo(ws).finished;
  ws.close();

  pipeToPromise.catch(e => {
    t.equal(e.constructor, TypeError, 'pipeTo finished promise should reject with a TypeError');
    t.equal(recordedReason.constructor, TypeError, 'the recorded cancellation reason should be a TypeError');
    t.end();
  });
});

test('Piping to a stream that errors on write should pass through the error as the cancellation reason', t => {
  let recordedReason;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
    },
    cancel(reason) {
      t.equal(reason, passedError, 'the recorded cancellation reason must be the passed error');
      t.end();
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
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
});

test('Piping to a stream that errors on write should not pass through the error if the stream is already closed', t => {
  let cancelCalled = false;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
      close();
    },
    cancel() {
      cancelCalled = true;
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
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

  rs.pipeTo(ws).finished.then(
    () => t.fail('pipeTo finished promise should not fulfill'),
    r => {
      t.equal(r, passedError, 'pipeTo finished promise should reject with the same error as the write');
      t.equal(cancelCalled, false, 'cancel should not have been called');
      t.end();
    }
  );
});

test('Piping to a stream that errors soon after writing should pass through the error as the cancellation reason', t => {
  let recordedReason;
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      enqueue('c');
    },
    cancel(reason) {
      t.equal(reason, passedError, 'the recorded cancellation reason must be the passed error');
      t.end();
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
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
});

test('Piping to a writable stream that does not consume the writes fast enough exerts backpressure on the source',
     t => {
  const enqueueReturnValues = [];
  const rs = new ReadableStream({
    start(enqueue, close) {
      setTimeout(() => enqueueReturnValues.push(enqueue('a')), 100);
      setTimeout(() => enqueueReturnValues.push(enqueue('b')), 200);
      setTimeout(() => enqueueReturnValues.push(enqueue('c')), 300);
      setTimeout(() => enqueueReturnValues.push(enqueue('d')), 400);
      setTimeout(() => close(), 500);
    }
  });

  const chunksGivenToWrite = [];
  const chunksFinishedWriting = [];
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      chunksGivenToWrite.push(chunk);
      return new Promise(resolve => {
        setTimeout(() => {
          chunksFinishedWriting.push(chunk);
          resolve();
        }, 350);
      });
    }
  });

  startPromise.then(() => {
    rs.pipeTo(ws).finished.then(() => {
      t.deepEqual(enqueueReturnValues, [true, true, true, false], 'backpressure was correctly exerted at the source');
      t.deepEqual(chunksFinishedWriting, ['a', 'b', 'c', 'd'], 'all chunks were written');
      t.end();
    });

    t.equal(ws.state, 'writable', 'at t = 0 ms, ws should be writable');

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'at t = 125 ms, ws should be waiting');
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 125 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 125 ms, no chunks should have finished writing');

      // The queue was empty when 'a' (the very first chunk) was enqueued
      t.deepEqual(enqueueReturnValues, [true],
        'at t = 125 ms, the one enqueued chunk in rs did not cause backpressure');
    }, 125);

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'at t = 225 ms, ws should be waiting');
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 225 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 225 ms, no chunks should have finished writing');

      // When 'b' was enqueued at 200 ms, the queue was also empty, since immediately after enqueuing 'a' at
      // t = 100 ms, it was dequeued in order to fulfill the read() call that was made at time t = 0.
      t.deepEqual(enqueueReturnValues, [true, true],
        'at t = 225 ms, the two enqueued chunks in rs did not cause backpressure');
    }, 225);

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'at t = 325 ms, ws should be waiting');
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 325 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 325 ms, no chunks should have finished writing');

      // When 'c' was enqueued at 300 ms, the queue was again empty, since at time t = 200 ms when 'b' was enqueued,
      // it was immediately dequeued in order to fulfill the second read() call that was made at time t = 0.
      t.deepEqual(enqueueReturnValues, [true, true, true],
        'at t = 325 ms, the three enqueued chunks in rs did not cause backpressure');
    }, 325);

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'at t = 425 ms, ws should be waiting');
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 425 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 425 ms, no chunks should have finished writing');

      // When 'd' was enqueued at 400 ms, the queue was *not* empty. 'c' was still in it, since the write() of 'b' will
      // not finish until t = 100 ms + 350 ms = 450 ms. Thus backpressure should have been exerted.
      t.deepEqual(enqueueReturnValues, [true, true, true, false],
        'at t = 425 ms, the fourth enqueued chunks in rs did cause backpressure');
    }, 425);

    setTimeout(() => {
      t.equal(ws.state, 'waiting', 'at t = 475 ms, ws should be waiting');
      t.deepEqual(chunksGivenToWrite, ['a', 'b'], 'at t = 475 ms, ws.write should have been called with two chunks');
      t.deepEqual(chunksFinishedWriting, ['a'], 'at t = 475 ms, one chunk should have finished writing');
    }, 475);
  });
});
