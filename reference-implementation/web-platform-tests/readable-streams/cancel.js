'use strict';

if (self.importScripts) {
  self.importScripts('../resources/rs-utils.js');
  self.importScripts('/resources/testharness.js');
}

promise_test(t => {
    var randomSource = new RandomPushSource();

    var cancellationFinished = false;
    var rs = new ReadableStream({
        start: function(c) {
            randomSource.ondata = c.enqueue.bind(c);
            randomSource.onend = c.close.bind(c);
            randomSource.onerror = c.error.bind(c);
        },

        pull: function() {
            randomSource.readStart();
        },

        cancel: function() {
            randomSource.readStop();
            randomSource.onend();

            return new Promise(resolve => {
                setTimeout(() => {
                    cancellationFinished = true;
                    resolve();
                }, 1);
            });
        }
    });
    // We call setTimeout multiple times to avoid cancelling too early for the
    // source to enqueue at least one chunk.
    var cancel = new Promise(resolve => setTimeout(resolve, 5)).then(() => {
        return new Promise(resolve => setTimeout(resolve, 5));
    }).then(() => {
        return new Promise(resolve => setTimeout(resolve, 5));
    }).then(() => {
        return reader.cancel();
    });

    var reader = rs.getReader();
    return readableStreamToArray(rs, reader).then(chunks => {
        assert_greater_than(chunks.length, 0, 'at least one chunk should be read');
        for (var i = 0; i < chunks.length; i++) {
            assert_equals(chunks[i].length, 128, 'chunk ' + i + ' should have 128 bytes');
        }
        assert_false(cancellationFinished, 'it did not wait for the cancellation process to finish before closing');
        return cancel;
    }).then(() => {
        assert_true(cancellationFinished, 'it returns a promise that is fulfilled when the cancellation finishes');
    });
}, 'ReadableStream cancellation: integration test on an infinite stream derived from a random push source');

test(function() {
    var recordedReason;
    var rs = new ReadableStream({
        cancel: function(reason) {
            recordedReason = reason;
        }
    });

    var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
    rs.cancel(passedReason);

    assert_equals(recordedReason, passedReason,
                  'the error passed to the underlying source\'s cancel method should equal the one passed to the stream\'s cancel');
}, 'ReadableStream cancellation: cancel(reason) should pass through the given reason to the underlying source');

promise_test(t => {
    var rs = new ReadableStream({
        start: function(c) {
            c.enqueue('a');
            c.close();
        },
        cancel: function() {
            assert_unreached('underlying source cancel() should not have been called');
        }
    });

    var reader = rs.getReader();

    return rs.cancel().then(() => {
        assert_unreached('cancel() should be rejected');
    }, e => {
        assert_equals(e.name, 'TypeError', 'cancel() should be rejected with a TypeError');
    }).then(() => {
        return reader.read();
    }).then(result => {
        assert_object_equals(result, { value: 'a', done: false }, 'read() should still work after the attempted cancel');
        return reader.closed;
    });
}, 'ReadableStream cancellation: cancel() on a locked stream should fail and not call the underlying source cancel');

promise_test(t => {
    var cancelReceived = false;
    var cancelReason = new Error('I am tired of this stream, I prefer to cancel it');
    var rs = new ReadableStream({
        cancel: function(reason) {
            cancelReceived = true;
            assert_equals(reason, cancelReason, 'cancellation reason given to the underlying source should be equal to the one passed');
        }
    });

    return rs.cancel(cancelReason).then(() => {
        assert_true(cancelReceived);
    });
}, 'ReadableStream cancellation: should fulfill promise when cancel callback went fine');

promise_test(t => {
    var rs = new ReadableStream({
        cancel: function(reason) {
            return 'Hello';
        }
    });

    return rs.cancel().then(v => {
        assert_equals(v, undefined, 'cancel() return value should be fulfilled with undefined');
    });
}, 'ReadableStream cancellation: returning a value from the underlying source\'s cancel should not affect the fulfillment value of the promise returned by the stream\'s cancel');

promise_test(t => {
    var thrownError = new Error('test');
    var cancelCalled = false;

    var rs = new ReadableStream({
        cancel: function() {
            cancelCalled = true;
            throw thrownError;
        }
    });

    return rs.cancel('test').then(() => {
      assert_unreached('cancel should reject');
    }, e => {
      assert_true(cancelCalled);
      assert_equals(e, thrownError);
    });
}, 'ReadableStream cancellation: should reject promise when cancel callback raises an exception');

promise_test(t => {
    var cancelReason = new Error('test');

    var rs = new ReadableStream({
        cancel: function(error) {
            assert_equals(error, cancelReason);
            return new Promise(resolve => setTimeout(resolve, 1));
        }
    });

    return rs.cancel(cancelReason);
}, 'ReadableStream cancellation: if the underlying source\'s cancel method returns a promise, the promise returned by the stream\'s cancel should fulfill when that one does (1)');

promise_test(t => {
    var resolveSourceCancelPromise;
    var sourceCancelPromiseHasFulfilled = false;
    var rs = new ReadableStream({
        cancel: function() {
            var sourceCancelPromise = new Promise(function(resolve, reject) {
                resolveSourceCancelPromise = resolve;
            });
            sourceCancelPromise.then(() => {
                sourceCancelPromiseHasFulfilled = true;
            });
            return sourceCancelPromise;
        }
    });

    setTimeout(() => resolveSourceCancelPromise('Hello'), 1);

    return rs.cancel().then(value => {
        assert_true(sourceCancelPromiseHasFulfilled, 'cancel() return value should be fulfilled only after the promise returned by the underlying source\'s cancel');
        assert_equals(value, undefined, 'cancel() return value should be fulfilled with undefined');
    });
}, 'ReadableStream cancellation: if the underlying source\'s cancel method returns a promise, the promise returned by the stream\'s cancel should fulfill when that one does (2)');

promise_test(t => {
    var rejectSourceCancelPromise;
    var sourceCancelPromiseHasRejected = false;
    var rs = new ReadableStream({
        cancel: function() {
            var sourceCancelPromise = new Promise(function(resolve, reject) {
                rejectSourceCancelPromise = reject;
            });

            sourceCancelPromise.catch(function() {
                sourceCancelPromiseHasRejected = true;
            });

            return sourceCancelPromise;
        }
    });

    var errorInCancel = new Error('Sorry, it just wasn\'t meant to be.');

    setTimeout(() => rejectSourceCancelPromise(errorInCancel), 1);

    return rs.cancel().then(() => {
        assert_unreached('cancel() return value should be rejected');
    }, r => {
        assert_true(sourceCancelPromiseHasRejected, 'cancel() return value should be rejected only after the promise returned by the underlying source\'s cancel');
        assert_equals(r, errorInCancel, 'cancel() return value should be rejected with the underlying source\'s rejection reason');
    });
}, 'ReadableStream cancellation: if the underlying source\'s cancel method returns a promise, the promise returned by the stream\'s cancel should reject when that one does');

promise_test(t => {
    var rs = new ReadableStream({
        start: function() {
            return new Promise(() => {});
        },
        pull: function() {
            assert_unreached('pull should not have been called');
        }
    });

    return Promise.all([rs.cancel(), rs.getReader().closed]);
}, 'ReadableStream cancellation: cancelling before start finishes should prevent pull() from being called');

done();
