var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';
import passThroughTransform from './utils/pass-through-transform';

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

  rs.pipeTo(dest);
});

test('Piping through a pass-through transform stream works', t => {
  t.plan(1);

  var output = sequentialReadableStream(5).pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
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
    write(chunk, done, error) {
      if (++written > 1) {
        error(passedError);
      } else {
        done();
      }
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
    write(chunk, done, error) {
      if (++written > 1) {
        setTimeout(() => error(passedError), 10);
      } else {
        done();
      }
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
    write(chunk, done, error) {
      if (++written > 1) {
        error(passedError);
      } else {
        done();
      }
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
    write(chunk, done, error) {
      if (++written > 1) {
        error(new Error('producer will not see this'));
      } else {
        done();
      }
    }
  });

  rs.pipeTo(ws);

  setTimeout(() => {
    t.equal(cancelCalled, false, 'cancel must not be called');
    t.equal(ws.state, 'errored', 'the writable stream must still be in an errored state');
    t.end();
  }, 20);
});
