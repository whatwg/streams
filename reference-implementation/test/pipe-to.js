'use strict';
const test = require('tape-catch');

const sequentialReadableStream = require('./utils/sequential-rs.js');

// TODO: many asserts in this file are unlabeled; we should label them.

function promise_fulfills(t, expectedValue, promise, msg) {
  promise.then(value => {
    t.equal(value, expectedValue, msg);
  }, reason => {
    t.fail(msg + ': Rejected unexpectedly with: ' + reason);
  });
}

function promise_rejects(t, expectedReason, promise, msg) {
  promise.then(value => {
    t.fail(msg + ': Fulfilled unexpectedly with: ' + value);
  }, reason => {
    if (typeof expectedReason === 'function') {
      t.equal(reason.constructor, expectedReason, msg);
    } else {
      t.equal(reason, expectedReason, msg);
    }
  });
}

test('Piping from a ReadableStream from which lots of data are readable synchronously', t => {
  t.plan(3);

  const rs = new ReadableStream({
    start(c) {
      for (let i = 0; i < 1000; ++i) {
        c.enqueue(i);
      }
      c.close();
    }
  });

  const ws = new WritableStream({}, new CountQueuingStrategy({ highWaterMark: 1000 }));

  let pipeFinished = false;
  rs.pipeTo(ws).then(
    () => {
      pipeFinished = true;
      rs.getReader().closed.then(() => {
        t.pass('readable stream should be closed after pipe finishes');
      });
      promise_fulfills(t, undefined, ws.getWriter().closed,
                       'writable stream should be closed after pipe finishes');
    }
  )
  .catch(e => t.error(e));

  setTimeout(() => {
    t.equal(pipeFinished, true, 'pipe should have finished before a setTimeout(,0) since it should only be microtasks');
  }, 0);
});

test('Piping from a ReadableStream in readable state to a WritableStream in closing state', t => {
  t.plan(3);

  let cancelReason;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('Hello');
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

  const writer = ws.getWriter();
  writer.close().then(() => {
    writer.releaseLock();

    rs.pipeTo(ws).then(
      () => t.fail('promise returned by pipeTo should not fulfill'),
      r => {
        t.equal(r, cancelReason,
                'the pipeTo promise should reject with the same error as the underlying source cancel was called with');
        rs.getReader().closed.then(() => {
          t.pass('readable stream should be closed after pipe finishes');
        });
      }
     )
     .catch(e => t.error(e));
  });
});

test('Piping from a ReadableStream in readable state to a WritableStream in errored state', t => {
  let cancelCalled = false;
  const passedError = new Error('horrible things');
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('Hello');
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
    const writer = ws.getWriter();

    writer.write('Hello');
    t.assert(writeCalled, 'write must be called');

    writer.closed.catch(() => {
      writer.releaseLock();
      rs.pipeTo(ws).catch(e => {
        t.equal(e, passedError, 'pipeTo promise should be rejected with the error');
        t.assert(cancelCalled, 'cancel should have been called');
        t.end();
      });
    });
  })
  .catch(e => t.error(e));
});

test('Piping from a ReadableStream in the readable state which becomes closed after pipeTo call to a WritableStream ' +
     'in the writable state', t => {
  t.plan(4);

  let closeReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('Hello');
      closeReadableStream = c.close.bind(c);
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
    rs.pipeTo(ws).then(() => {
      const writer = ws.getWriter();
      promise_fulfills(t, undefined, writer.closed, 'writer.closed promise should fulfill');
    });

    closeReadableStream();
  })
  .catch(e => t.error(e));
});

test('Piping from a ReadableStream in the readable state which becomes errored after pipeTo call to a WritableStream ' +
     'in the writable state', t => {
  t.plan(4);

  let errorReadableStream;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('Hello');
      errorReadableStream = c.error.bind(c);
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  const passedError = new Error('horrible things');
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
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
    rs.pipeTo(ws).catch(e => {
      t.equal(e, passedError, 'pipeTo should be rejected with the passed error');
      const writer = ws.getWriter();
      promise_rejects(t, TypeError, writer.closed, 'writer.closed should reject');
    });

    errorReadableStream(passedError);
  })
  .catch(e => t.error(e));
});

test('Piping from an empty ReadableStream which becomes non-empty after pipeTo call to a WritableStream in the ' +
     'writable state', t => {
  t.plan(2);

  let controller;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
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
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  rs.pipeTo(ws).then(() => t.fail('pipeTo promise should not fulfill'));

  controller.enqueue('Hello');
});

test('Piping from an empty ReadableStream which becomes errored after pipeTo call to a WritableStream in the ' +
    'writable state', t => {
  t.plan(2);

  let errorReadableStream;
  const rs = new ReadableStream({
    start(c) {
      errorReadableStream = c.error.bind(c);
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

  rs.pipeTo(ws).catch(e => t.equal(e, passedError, 'pipeTo should reject with the passed error'));

  errorReadableStream(passedError);
});

test('Piping from an empty ReadableStream to a WritableStream in the writable state which becomes errored after a ' +
     'pipeTo call', t => {
  t.plan(4);

  const theError = new Error('cancel with me!');

  let pullCount = 0;
  const rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel(reason) {
      t.equal(reason, theError, 'underlying source cancellation reason should be the writable stream error');
      t.equal(pullCount, 2, 'pull should have been called twice by cancel-time');
    }
  });

  let writableController;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start(c) {
      writableController = c;
      return startPromise;
    },
    write() {
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
    rs.pipeTo(ws).catch(e => {
      t.equal(e, theError, 'pipeTo should reject with the passed error');

      promise_rejects(t, theError, ws.getWriter().closed, 'ws.closed should reject with theError');
    })
    .catch(e => t.error(e));

    writableController.error(theError);
  })
  .catch(e => t.error(e));
});

test('Piping from a non-empty ReadableStream to a WritableStream in the waiting state which becomes writable after a ' +
     'pipeTo call', t => {
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('World');
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
        t.equal(chunk, 'Hello', 'the first chunk to arrive in write should be the first chunk written');
        return new Promise(resolve => {
          resolveWritePromise = resolve;
        });
      }

      t.equal(chunk, 'World', 'the second chunk to arrive in write should be from the readable stream');
      t.equal(pullCount, 1, 'the readable stream\'s pull should have been called once');
      t.end();
      return Promise.resolve();
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  startPromise.then(() => {
    const writer = ws.getWriter();
    writer.write('Hello').catch(e => t.error(e, 'write() rejected'));
    writer.releaseLock();

    rs.pipeTo(ws).catch(e => t.error(e, 'rs.pipeTo() rejected'));

    resolveWritePromise();
  })
  .catch(e => t.error(e, 'startPromise.then() rejected'));
});

test('Piping from a non-empty ReadableStream to a WritableStream in waiting state which becomes errored after a ' +
     'pipeTo call', t => {
  let writeCalled = false;

  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('World');
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

  let writableController;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start(c) {
      writableController = c;
      return startPromise;
    },
    write(chunk) {
      t.assert(!writeCalled);
      t.equal(chunk, 'Hello');
      writeCalled = true;
      return new Promise(() => { });
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');
  writer.releaseLock();

  startPromise.then(() => {
    rs.pipeTo(ws);

    writableController.error();
  });
});

test('Piping from a non-empty ReadableStream which becomes errored after pipeTo call to a WritableStream in the ' +
     'waiting state', t => {
  t.plan(4);

  let readableController;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('World');
      readableController = c;
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

      return new Promise(() => { });
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.pass('underlying source abort was called');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');
  writer.releaseLock();

  startPromise.then(() => {
    t.equal(pullCount, 0);

    rs.pipeTo(ws);

    readableController.error();
  });
});

test('Piping from a non-empty ReadableStream to a WritableStream in the waiting state where both become ready ' +
     'after a pipeTo', t => {
  let readableController;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      readableController = c;
    },
    pull() {
      ++pullCount;
    },
    cancel() {
      t.fail('Unexpected cancel call');
    }
  });

  let writeCount = 0;
  let resolveWritePromise;
  const startPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return startPromise;
    },
    write(chunk) {
      ++writeCount;

      if (writeCount === 1) {
        t.equal(chunk, 'Hello', 'first chunk written should equal the one passed to ws.write');
        return new Promise(resolve => {
          resolveWritePromise = resolve;
        });
      }
      if (writeCount === 2) {
        t.equal(chunk, 'Goodbye', 'second chunk written should be from the source readable stream');
        t.end();
      }

      return Promise.resolve();
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');

  startPromise.then(() => {
    t.equal(writeCount, 1, 'exactly one write should have happened');
    t.equal(writer.desiredSize, 0, 'writer.desiredSize should be 0');
    writer.releaseLock();

    t.equal(pullCount, 1, 'pull should have been called only once');
    rs.pipeTo(ws);

    readableController.enqueue('Goodbye');

    // Check that nothing happens before calling resolveWritePromise(), and then call resolveWritePromise()
    // to check that pipeTo is woken up.
    t.equal(pullCount, 1, 'after the pipeTo and enqueue, pull still should have been called only once');

    resolveWritePromise();
  })
  .catch(e => t.error(e, 'startPromise.then() rejected'));
});

test('Piping from an empty ReadableStream to a WritableStream in the waiting state which becomes writable after a ' +
     'pipeTo() call', t => {
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
      return new Promise(resolve => {
        resolveWritePromise = resolve;
      });
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');
  writer.releaseLock();

  startPromise.then(() => {
    rs.pipeTo(ws);

    t.equal(pullCount, 1);

    resolveWritePromise();
    setTimeout(() => {
      t.equal(pullCount, 2);

      t.end();
    }, 100);
  });
});

test('Piping from an empty ReadableStream which becomes closed after a pipeTo() call to a WritableStream in the ' +
     'waiting state whose writes never complete', t => {
  t.plan(2);

  let readableController;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      readableController = c;
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
        readableController.close();
      } else {
        t.fail('Unexpected extra write call');
      }
      return new Promise(() => { });
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort() {
      t.fail('Unexpected abort call');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');
  writer.releaseLock();

  startPromise.then(() => {
    rs.pipeTo(ws).catch(e => t.error(e, 'rs.pipeTo() rejected'));

    setTimeout(() => {
      t.equal(pullCount, 1, 'pull should have been called only once');
    }, 50);
  })
  .catch(e => t.error(e, 'startPromise.then() rejected'));
});

test('Piping from an empty ReadableStream which becomes errored after a pipeTo call to a WritableStream in the ' +
     'waiting state', t => {
  t.plan(4);

  let readableController;
  let pullCount = 0;
  const rs = new ReadableStream({
    start(c) {
      readableController = c;
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
        t.equal(chunk, 'Hello', 'chunk');
        writeCalled = true;
      } else {
        t.fail('Unexpected extra write call');
      }
      return new Promise(() => { });
    },
    close() {
      t.fail('Unexpected close call');
    },
    abort(reason) {
      t.equal(reason, passedError, 'reason should be passedError');
      t.assert(writeCalled, 'writeCalled should be true');
      t.equal(pullCount, 1, 'pullCount should be 1');
    }
  });

  const writer = ws.getWriter();
  writer.write('Hello');
  writer.releaseLock();

  startPromise.then(() => {
    rs.pipeTo(ws);

    readableController.error(passedError);
  });
});

test('Piping to a duck-typed asynchronous "writable stream" works', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  const rs = sequentialReadableStream(5, { async: true });

  const chunksWritten = [];
  const writer = {
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
    closed: new Promise(() => { })
  };

  const ws = {
    getWriter() { return writer; }
  };

  rs.pipeTo(ws);
});

test('Piping to a stream that has been aborted passes through the error as the cancellation reason', t => {
  let recordedCancelReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedCancelReason = reason;
    }
  });

  const ws = new WritableStream();
  const passedReason = new Error('I don\'t like you.');
  const writer = ws.getWriter();
  writer.abort(passedReason);
  writer.releaseLock();

  rs.pipeTo(ws).catch(e => {
    t.equal(e.constructor, TypeError, 'pipeTo rejection reason should be a TypeError');
    t.equal(recordedCancelReason.constructor, TypeError, 'the recorded cancellation reason must be a TypeError');
    t.end();
  })
  .catch(e => t.error(e));
});

test('Piping to a stream that has been closed propagates a TypeError cancellation reason backward', t => {
  let recordedCancelReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedCancelReason = reason;
    }
  });

  const ws = new WritableStream();
  const writer = ws.getWriter();
  writer.close().then(() => {
    writer.releaseLock();
    rs.pipeTo(ws).catch(e => {
      t.equal(e.constructor, TypeError, 'the rejection reason for the pipeTo promise should be a TypeError');
      t.equal(recordedCancelReason.constructor, TypeError, 'the recorded cancellation reason should be a TypeError');
      t.end();
    })
    .catch(e => t.error(e));
  })
  .catch(e => t.error(e));
});

test('Piping to a stream that errors on write should pass through the error as the cancellation reason', t => {
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.enqueue('c');
    },
    cancel(reason) {
      t.equal(reason, passedError, 'the recorded cancellation reason must be the passed error');
      t.end();
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
    write() {
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
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.enqueue('c');
      c.close();
    },
    cancel() {
      cancelCalled = true;
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
    write() {
      return new Promise((resolve, reject) => {
        if (++written > 1) {
          reject(passedError);
        } else {
          resolve();
        }
      });
    }
  });

  rs.pipeTo(ws).then(
    () => t.fail('pipeTo should not fulfill'),
    r => {
      t.equal(r, passedError, 'pipeTo should reject with the same error as the write');
      t.equal(cancelCalled, false, 'cancel should not have been called');
      t.end();
    }
  );
});

test('Piping to a stream that errors soon after writing should pass through the error as the cancellation reason',
t => {
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.enqueue('c');
    },
    cancel(reason) {
      t.equal(reason, passedError, 'the recorded cancellation reason must be the passed error');
      t.end();
    }
  });

  let written = 0;
  const passedError = new Error('I don\'t like you.');
  const ws = new WritableStream({
    write() {
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
  const desiredSizes = [];
  const rs = new ReadableStream({
    start(c) {
      setTimeout(() => enqueue('a'), 100);
      setTimeout(() => enqueue('b'), 200);
      setTimeout(() => enqueue('c'), 300);
      setTimeout(() => enqueue('d'), 400);
      setTimeout(() => c.close(), 500);

      function enqueue(chunk) {
        c.enqueue(chunk);
        desiredSizes.push(c.desiredSize);
      }
    }
  });

  const chunksGivenToWrite = [];
  const chunksFinishedWriting = [];
  const writableStartPromise = Promise.resolve();
  const ws = new WritableStream({
    start() {
      return writableStartPromise;
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

  writableStartPromise.then(() => {
    rs.pipeTo(ws).then(() => {
      t.deepEqual(desiredSizes, [1, 1, 0, -1], 'backpressure was correctly exerted at the source');
      t.deepEqual(chunksFinishedWriting, ['a', 'b', 'c', 'd'], 'all chunks were written');
      t.end();
    });

    setTimeout(() => {
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 125 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 125 ms, no chunks should have finished writing');

      // When 'a' (the very first chunk) was enqueued, it was immediately used to fulfill the outstanding read request
      // promise, leaving room in the queue
      t.deepEqual(desiredSizes, [1],
        'at t = 125 ms, the one enqueued chunk in rs did not cause backpressure');
    }, 125);

    setTimeout(() => {
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 225 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 225 ms, no chunks should have finished writing');

      // When 'b' was enqueued at 200 ms, the queue was also empty, since immediately after enqueuing 'a' at
      // t = 100 ms, it was dequeued in order to fulfill the read() call that was made at time t = 0.
      t.deepEqual(desiredSizes, [1, 1],
        'at t = 225 ms, the two enqueued chunks in rs did not cause backpressure');
    }, 225);

    setTimeout(() => {
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 325 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 325 ms, no chunks should have finished writing');

      // When 'c' was enqueued at 300 ms, the queue was again empty, since at time t = 200 ms when 'b' was enqueued,
      // it was immediately dequeued in order to fulfill the second read() call that was made at time t = 0.
      // However, this time there was no pending read request to whisk it away, so after the enqueue desired size is 0.
      t.deepEqual(desiredSizes, [1, 1, 0],
        'at t = 325 ms, the three enqueued chunks in rs did not cause backpressure');
    }, 325);

    setTimeout(() => {
      t.deepEqual(chunksGivenToWrite, ['a'], 'at t = 425 ms, ws.write should have been called with one chunk');
      t.deepEqual(chunksFinishedWriting, [], 'at t = 425 ms, no chunks should have finished writing');

      // When 'd' was enqueued at 400 ms, the queue was *not* empty. 'c' was still in it, since the write() of 'b' will
      // not finish until t = 100 ms + 350 ms = 450 ms. Thus backpressure should have been exerted.
      t.deepEqual(desiredSizes, [1, 1, 0, -1],
        'at t = 425 ms, the fourth enqueued chunks in rs did cause backpressure');
    }, 425);

    setTimeout(() => {
      t.deepEqual(chunksGivenToWrite, ['a', 'b'], 'at t = 475 ms, ws.write should have been called with two chunks');
      t.deepEqual(chunksFinishedWriting, ['a'], 'at t = 475 ms, one chunk should have finished writing');
    }, 475);
  });
});
