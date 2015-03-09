const test = require('tape-catch');

import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream cancellation: integration test on an infinite stream derived from a random push source', t => {
  const randomSource = new RandomPushSource();

  let cancellationFinished = false;
  const rs = new ReadableStream({
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
        cancellationFinished = true;
        resolve();
      }, 50));
    }
  });

  readableStreamToArray(rs).then(
    chunks => {
      t.equal(cancellationFinished, false, 'it did not wait for the cancellation process to finish before closing');
      t.ok(chunks.length > 0, 'at least one chunk should be read');
      for (let i = 0; i < chunks.length; i++) {
        t.equal(chunks[i].length, 128, `chunk ${i + 1} should have 128 bytes`);
      }
    },
    e => t.error(e)
  );

  setTimeout(() => {
    rs.cancel().then(() => {
      t.equal(cancellationFinished, true, 'it returns a promise that is fulfilled when the cancellation finishes');
      t.end();
    })
    .catch(e => t.error(e));
  }, 150);
});

test('ReadableStream cancellation: cancel(reason) should pass through the given reason to the underlying source', t => {
  let recordedReason;
  const rs = new ReadableStream({
    cancel(reason) {
      recordedReason = reason;
    }
  });

  const passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  rs.cancel(passedReason);

  t.equal(recordedReason, passedReason,
    'the error passed to the underlying source\'s cancel method should equal the one passed to the stream\'s cancel');
  t.end();
});

test('ReadableStream cancellation: returning a value from the underlying source\'s cancel should not affect the ' +
     'fulfillment value of the promise returned by the stream\'s cancel', t => {
  t.plan(1);

  const rs = new ReadableStream({
    cancel(reason) {
      return 'Hello';
    }
  });

  rs.cancel().then(
    v => t.equal(v, undefined, 'cancel() return value should be fulfilled with undefined'),
    () => t.fail('cancel() return value should not be rejected')
  );
});

test('ReadableStream cancellation: if the underlying source\'s cancel method returns a promise, the promise returned ' +
     'by the stream\'s cancel should fulfill when that one does', t => {

  let resolveSourceCancelPromise;
  let sourceCancelPromiseHasFulfilled = false;
  const rs = new ReadableStream({
    cancel() {
      const sourceCancelPromise = new Promise((resolve, reject) => {
        resolveSourceCancelPromise = resolve;
      });

      sourceCancelPromise.then(() => {
        sourceCancelPromiseHasFulfilled = true;
      });

      return sourceCancelPromise;
    }
  });


  rs.cancel().then(
    value => {
      t.equal(sourceCancelPromiseHasFulfilled, true,
        'cancel() return value should be fulfilled only after the promise returned by the underlying source\'s cancel');
      t.equal(value, undefined, 'cancel() return value should be fulfilled with undefined');
      t.end();
    },
    () => t.fail('cancel() return value should not be rejected')
  );

  setTimeout(() => {
    resolveSourceCancelPromise('Hello');
  }, 30);
});

test('ReadableStream cancellation: if the underlying source\'s cancel method returns a promise, the promise returned ' +
     'by the stream\'s cancel should reject when that one does', t => {
  let rejectSourceCancelPromise;
  let sourceCancelPromiseHasRejected = false;
  const rs = new ReadableStream({
    cancel() {
      const sourceCancelPromise = new Promise((resolve, reject) => {
        rejectSourceCancelPromise = reject;
      });

      sourceCancelPromise.catch(() => {
        sourceCancelPromiseHasRejected = true;
      });

      return sourceCancelPromise;
    }
  });

  const errorInCancel = new Error('Sorry, it just wasn\'t meant to be.');

  rs.cancel().then(
    () => t.fail('cancel() return value should not be rejected'),
    r => {
      t.equal(sourceCancelPromiseHasRejected, true,
        'cancel() return value should be rejected only after the promise returned by the underlying source\'s cancel');
      t.equal(r, errorInCancel,
        'cancel() return value should be rejected with the underlying source\'s rejection reason');
      t.end();
    }
  );

  setTimeout(() => {
    rejectSourceCancelPromise(errorInCancel);
  }, 30);
});

test('ReadableStream cancellation: cancelling before start finishes should prevent pull() from being called', t => {
  const rs = new ReadableStream({
    pull() {
      t.fail('pull should not have been called');
      t.end();
    }
  });

  Promise.all([rs.cancel(), rs.closed]).then(() => {
    t.pass('pull should never have been called');
    t.end();
  })
  .catch(e => t.error(e));
});
