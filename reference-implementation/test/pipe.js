var test = require('tape');

import sequentialReadableStream from './utils/sequential-rs';
import duckTypedPassThroughTransform from './utils/duck-typed-pass-through-transform';
import readableStreamToArray from './utils/readable-stream-to-array';
import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import CountQueuingStrategy from '../lib/count-queuing-strategy';
import sequentialReadableStream from './utils/sequential-rs';

test('Piping through a duck-typed pass-through transform stream works', t => {
  t.plan(1);

  var output = sequentialReadableStream(5).pipe(duckTypedPassThroughTransform());

  readableStreamToArray(output).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});

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

  rs.pipe(ws);
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

  rs.pipe(ws);
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

      t.strictEqual(reason, passedError);
    }
  });
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk, done, error) {
      t.assert(!writeCalled, 'write must not be called more than once');
      writeCalled = true;

      t.equal(chunk, 'Hello');

      error(passedError);
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
    t.equal(ws.state, 'errored', 'as a result of error call, ws must be in errored state');

    rs.pipe(ws);

    // Need to delay because pipeTo retrieves error from dest using wait().
    setTimeout(() => {
      t.assert(cancelCalled);
      t.equal(rs.state, 'closed');
      t.end();
    }, 0);
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
    write(chunk, done, error) {
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

    rs.pipe(ws);
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
    write(chunk, done, error) {
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

    rs.pipe(ws);

    // Need to delay because pipeTo retrieves error from dest using wait().
    setTimeout(() => {
      t.assert(abortCalled);
      t.equal(ws.state, 'errored');
      t.end();
    }, 0);
  }, 0);
});

test(`Piping from a ReadableStream in readable state which becomes closed after pipeTo call to a WritableStream in
 writable state`, t => {
  var closeReadableStream;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue("Hello");
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
    write(chunk, done) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
        done();
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
    rs.pipe(ws);
    t.equal(rs.state, 'waiting', 'transfer must happen synchronously, and then rs enters waiting state');
    t.equal(ws.state, 'writable');

    closeReadableStream();
  }, 0);
});

test(`Piping from a ReadableStream in readable state which becomes errored after pipeTo call to a WritableStream in
 writable state`, t => {
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
    write(chunk, done) {
      if (!writeCalled) {
        t.equal(chunk, 'Hello');
        writeCalled = true;
        done();
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
      t.strictEqual(reason, passedError);
      t.assert(writeCalled);
      t.equal(pullCount, 1);

      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    rs.pipe(ws);
    t.equal(rs.state, 'waiting', 'transfer must happen synchronously, and then rs enters waiting state');
    t.equal(ws.state, 'writable');

    errorReadableStream(passedError);
  }, 0);
});

test(`Piping from a ReadableStream in waiting state which becomes readable after pipeTo call to a WritableStream in
 writable state`, t => {
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

      // Includes pull invoked inside read()
      t.equal(pullCount, 2);

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

  rs.pipe(ws);
  t.equal(rs.state, 'waiting');
  t.equal(ws.state, 'writable');

  enqueue('Hello');
});

test(`Piping from a ReadableStream in waiting state which becomes errored after pipeTo call to a WritableStream in
 writable state`, t => {
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
      t.strictEqual(reason, passedError);

      t.equal(pullCount, 1);

      t.end();
    }
  });

  rs.pipe(ws);
  t.equal(rs.state, 'waiting');
  t.equal(ws.state, 'writable');

  errorReadableStream(passedError);
  t.equal(rs.state, 'errored');
});

test(`Piping from a ReadableStream in waiting state to a WritableStream in writable state which becomes errored after
 pipeTo call`, t => {
  var writeCalled = false;

  var pullCount = 0;
  var rs = new ReadableStream({
    pull() {
      ++pullCount;
    },
    cancel() {
      t.equal(pullCount, 1);
      t.assert(writeCalled);
      t.end();
    }
  });

  var errorWritableStream;
  var ws = new WritableStream({
    write(chunk, done, error) {
      t.assert(!writeCalled);
      writeCalled = true;

      t.equal(chunk, 'Hello');

      errorWritableStream = error;

      done();
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
    t.equal(ws.state, 'writable');

    rs.pipe(ws);
    t.equal(rs.state, 'waiting');
    t.equal(ws.state, 'writable');

    errorWritableStream();
    t.equal(ws.state, 'errored');
  }, 0);
});

test(`Piping from a ReadableStream in readable state to a WritableStream in waiting state which becomes writable after
 pipeTo call`, t => {
  var enqueue;
  var pullCount = 0;
  var rs = new ReadableStream({
    start(enqueue) {
      enqueue("World");
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

  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      if (!done) {
        t.equal(chunk, 'Hello');
        done = done_;
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

    rs.pipe(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    done();
    t.equal(ws.state, 'writable');
  }, 0);
});

test(`Piping from a ReadableStream in readable state to a WritableStream in waiting state which becomes errored after
 pipeTo call`, t => {
  var writeCalled = false;

  var enqueue;
  var rs = new ReadableStream({
    start(enqueue) {
      enqueue("World");
    },
    pull() {
      t.fail('Unexpected pull call');
      t.end();
    },
    cancel() {
      t.assert(writeCalled);

      t.end();
    }
  });
  t.equal(rs.state, 'readable');

  var errorWritableStream;
  var ws = new WritableStream({
    write(chunk, done, error) {
      t.assert(!writeCalled);
      t.equal(chunk, 'Hello');
      writeCalled = true;
      errorWritableStream = error;
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

    rs.pipe(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    errorWritableStream();
    t.equal(ws.state, 'errored');
  }, 0);
});

test(`Piping from a ReadableStream in readable state which becomes errored after pipeTo call to a WritableStream in
 waiting state`, t => {
  var errorReadableStream;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      enqueue("World");
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
  t.equal(rs.state, 'readable');

  var writeCalled = false;
  var ws = new WritableStream({
    write(chunk, done) {
      t.assert(!writeCalled);
      writeCalled = true;

      t.equal(chunk, 'Hello');
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

    rs.pipe(ws);
    t.equal(rs.state, 'readable', 'transfer of data must not happen until ws becomes writable');
    t.equal(ws.state, 'waiting');

    errorReadableStream();
    t.equal(rs.state, 'errored');
  }, 0);
});

test(`Piping from a ReadableStream in waiting state to a WritableStream in waiting state where both become ready after
 pipeTo`, t => {
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

  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      if (checkSecondWrite) {
        t.equal(chunk, 'Goodbye');
        t.end();
      } else {
        t.assert(!done);
        done = done_;

        t.equal(chunk, 'Hello');
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
    t.assert(done);
    t.equal(ws.state, 'waiting');

    rs.pipe(ws);

    enqueue('Goodbye');

    // Check that nothing happens before calling done(), and then call done()
    // to check that pipeTo is woken up.
    setTimeout(() => {
      t.equal(pullCount, 1);

      checkSecondWrite = true;

      done();
    }, 100);
  }, 0);
});

test(`Piping from a ReadableStream in waiting state to a WritableStream in waiting state which becomes writable after
 pipeTo call`, t => {
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

  var done;
  var ws = new WritableStream({
    write(chunk, done_) {
      t.assert(!done);
      done = done_;

      t.equal(chunk, 'Hello');
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

    rs.pipe(ws);
    t.equal(rs.state, 'waiting');
    t.equal(ws.state, 'waiting');

    done();
    // Check that nothing happens.
    setTimeout(() => {
      t.equal(pullCount, 1);

      t.end();
    }, 100);
  }, 0);
});

test(`Piping from a ReadableStream in waiting state which becomes closed after pipeTo call to a WritableStream in
 waiting state`, t => {
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

    rs.pipe(ws);

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

test(`Piping from a ReadableStream in waiting state which becomes errored after pipeTo call to a WritableStream in
 waiting state`, t => {
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
    },
    close() {
      t.fail('Unexpected close call');
      t.end();
    },
    abort(reason) {
      t.strictEqual(reason, passedError);
      t.assert(writeCalled);
      t.equal(pullCount, 1);
      t.end();
    }
  });
  ws.write('Hello');

  // Wait for ws to start.
  setTimeout(() => {
    t.equal(ws.state, 'waiting');

    rs.pipe(ws);

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
    close() {
      t.deepEqual(chunksWritten, [1, 2, 3, 4, 5]);
      return Promise.resolve();
    },
    abort() {
      t.fail('Should not call abort');
    },
    closed: new Promise(() => {})
  };

  rs.pipe(dest);
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

  rs.pipe(ws);

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

  rs.pipe(ws);
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

  rs.pipe(ws);

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

  rs.pipe(ws);
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
    write(chunk, done, error) {
      if (++written > 1) {
        error(passedError);
      } else {
        done();
      }
    }
  });

  rs.pipe(ws);

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
    write(chunk, done, error) {
      if (++written > 1) {
        setTimeout(() => error(passedError), 10);
      } else {
        done();
      }
    }
  });

  rs.pipe(ws);

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
    write(chunk, done, error) {
      if (++written > 1) {
        error(passedError);
      } else {
        done();
      }
    }
  });

  rs.pipe(ws);

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
    write(chunk, done, error) {
      if (++written > 1) {
        error(new Error('producer will not see this'));
      } else {
        done();
      }
    }
  });

  rs.pipe(ws);

  setTimeout(() => {
    t.equal(cancelCalled, false, 'cancel must not be called');
    t.equal(ws.state, 'errored', 'the writable stream must still be in an errored state');
    t.end();
  }, 20);
});
