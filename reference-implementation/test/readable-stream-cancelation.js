var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream canceling an infinite stream', t => {
  var randomSource = new RandomPushSource();

  var cancelationFinished = false;
  var rs = new ReadableStream({
    start(enqueue, close, error) {
      randomSource.ondata = enqueue;
      randomSource.onend = close;
      randomSource.onerror = error;
    },

    pull() {
      randomSource.readStart();
    },

    cancel() {
      randomSource.readStop();
      randomSource.onend();

      return new Promise(resolve => setTimeout(() => {
        cancelationFinished = true;
        resolve();
      }, 50));
    }
  });

  readableStreamToArray(rs).then(
    storage => {
      t.equal(rs.state, 'closed', 'stream should be closed');
      t.equal(cancelationFinished, false, 'it did not wait for the cancellation process to finish before closing');
      t.ok(storage.length > 0, 'should have gotten some data written through the pipe');
      for (var i = 0; i < storage.length; i++) {
        t.equal(storage[i].length, 128, 'each chunk has 128 bytes');
      }
    },
    () => {
      t.fail('the stream should be successfully read to the end');
      t.end();
    }
  );

  setTimeout(() => {
    rs.cancel().then(() => {
      t.equal(cancelationFinished, true, 'it returns a promise that waits for the cancellation to finish');
      t.end();
    });
  }, 150);
});

test('ReadableStream cancellation puts the stream in a closed state (no chunks pulled yet)', t => {
  var rs = sequentialReadableStream(5);

  t.plan(5);

  rs.closed.then(
    () => t.assert(true, 'closed promise vended before the cancellation should fulfill'),
    () => t.fail('closed promise vended before the cancellation should not be rejected')
  );

  rs.wait().then(
    () => t.assert(true, 'wait() promise vended before the cancellation should fulfill'),
    () => t.fail('wait() promise vended before the cancellation should not be rejected')
  );

  rs.cancel();

  t.equal(rs.state, 'closed', 'state should be closed');

  rs.closed.then(
    () => t.assert(true, 'closed promise vended after the cancellation should fulfill'),
    () => t.fail('closed promise vended after the cancellation should not be rejected')
  );
  rs.wait().then(
    () => t.assert(true, 'wait promise vended after the cancellation should fulfill'),
    () => t.fail('wait promise vended after the cancellation should not be rejected')
  );
});

test('ReadableStream cancellation puts the stream in a closed state (after waiting for chunks)', t => {
  var rs = sequentialReadableStream(5);

  t.plan(5);

  rs.wait().then(
    () => {
      rs.closed.then(
        () => t.assert(true, 'closed promise vended before the cancellation should fulfill'),
        () => t.fail('closed promise vended before the cancellation should not be rejected')
      );

      rs.wait().then(
        () => t.assert(true, 'wait() promise vended before the cancellation should fulfill'),
        () => t.fail('wait() promise vended before the cancellation should not be rejected')
      );

      rs.cancel();

      t.equal(rs.state, 'closed', 'state should be closed');

      rs.closed.then(
        () => t.assert(true, 'closed promise vended after the cancellation should fulfill'),
        () => t.fail('closed promise vended after the cancellation should not be rejected')
      );
      rs.wait().then(
        () => t.assert(true, 'wait promise vended after the cancellation should fulfill'),
        () => t.fail('wait promise vended after the cancellation should not be rejected')
      );
    },
    r => t.ifError(r)
  );
});
