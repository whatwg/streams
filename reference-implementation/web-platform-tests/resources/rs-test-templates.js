'use strict';

// These tests can be run against any readable stream produced by the web platform that meets the given descriptions.
// For readable stream tests, the factory should return the stream. For reader tests, the factory should return a
// { stream, reader } object. (You can use this to vary the time at which you acquire a reader.)

self.templatedRSEmpty = function (label, factory) {
    test(function() {
    }, 'Running templatedRSEmpty with ' + label);

    test(function() {
        var rs = factory();

        assert_equals(typeof rs.locked, 'boolean', 'has a boolean locked getter');
        assert_equals(typeof rs.cancel, 'function', 'has a cancel method');
        assert_equals(typeof rs.getReader, 'function', 'has a getReader method');
        assert_equals(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');
        assert_equals(typeof rs.pipeTo, 'function', 'has a pipeTo method');
        assert_equals(typeof rs.tee, 'function', 'has a tee method');
    }, 'instances have the correct methods and properties');
};

self.templatedRSClosed = function (label, factory) {
    test(function() {
    }, 'Running templatedRSClosed with ' + label);

    var test1 = async_test('cancel() should return a distinct fulfilled promise each time');
    test1.step(function() {
        var rs = factory();
        var promisesCount = 0;
        var allChecked = false;

        var cancelPromise1 = rs.cancel();
        var cancelPromise2 = rs.cancel();

        cancelPromise1.then(test1.step_func(function(v) {
            assert_equals(v, undefined, 'first cancel() call should fulfill with undefined');
            ++promisesCount;
        }));
        cancelPromise2.then(test1.step_func(function(v) {
            assert_equals(v, undefined, 'second cancel() call should fulfill with undefined');
            assert_equals(++promisesCount, 2);
            assert_true(allChecked);
            test1.done();
        }));
        assert_not_equals(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
        allChecked = true;
    });

    test(function() {
        var rs = factory();

        assert_false(rs.locked, 'locked getter should return false');
    }, 'locked should be false');

    test(function() {
        var rs = factory();

        rs.getReader(); // getReader() should not throw.
    }, 'getReader() should be OK');

    test(function() {
        var rs = factory();

        var reader = rs.getReader();
        reader.releaseLock();

        reader = rs.getReader(); // Getting a second reader should not throw.
        reader.releaseLock();

        rs.getReader(); // Getting a third reader should not throw.
    }, 'should be able to acquire multiple readers if they are released in succession');

    test(function() {
        var rs = factory();

        rs.getReader();

        assert_throws(new TypeError(), function() { rs.getReader(); }, 'getting a second reader should throw');
        assert_throws(new TypeError(), function() { rs.getReader(); }, 'getting a third reader should throw');
    }, 'should not be able to acquire a second reader if we don\'t release the first one');
};

self.templatedRSErrored = function (label, factory, error) {
    test(function() {
    }, 'Running templatedRSErrored with ' + label);

    var test2 = async_test('getReader() should return a reader that acts errored');
    test2.step(function() {
        var rs = factory();
        var promisesCount = 0;

        var reader = rs.getReader();

        reader.closed.catch(test2.step_func(function(e) {
            assert_equals(e, error, 'reader.closed should reject with the error');
            if (++promisesCount === 2)
                test2.done();
        }));
        reader.read().catch(test2.step_func(function(e) {
            assert_equals(e, error, 'reader.read() should reject with the error');
            if (++promisesCount === 2)
                test2.done();
        }));
    });

    var test3 = async_test('read() twice should give the error each time');
    test3.step(function() {
        var rs = factory();
        var promiseCount = 0;

        var reader = rs.getReader();

        reader.read().catch(test3.step_func(function(e) {
            assert_equals(e, error, 'reader.read() should reject with the error');
            assert_equals(++promiseCount, 1);
        }));
        reader.read().catch(test3.step_func(function(e) {
            assert_equals(e, error, 'reader.read() should reject with the error');
            assert_equals(++promiseCount, 2);
        }));
        reader.closed.catch(test3.step_func(function(e) {
            assert_equals(e, error, 'reader.closed should reject with the error');
            assert_equals(++promiseCount, 3);
            test3.done();
        }));
   });

    test(function() {
        var rs = factory();

        assert_false(rs.locked, 'locked getter should return false');
    }, 'locked should be false');
};

self.templatedRSErroredSyncOnly = function (label, factory, error) {
    test(function() {
    }, 'Running templatedRSErroredSyncOnly with ' + label);

    var test1 = async_test('should be able to obtain a second reader, with the correct closed promise');
    test1.step(function() {
        var rs = factory();

        rs.getReader().releaseLock();

        var reader = rs.getReader(); // Calling getReader() twice does not throw (the stream is not locked).

        reader.closed.then(
            test1.step_func(function() { assert_unreached('closed promise should not be fulfilled when stream is errored'); }),
            test1.step_func(function(err) {
                assert_equals(err, error);
                test1.done();
            })
        );
    });

    test(function() {
        var rs = factory();

        rs.getReader();

        assert_throws(new TypeError(), function() { rs.getReader(); }, 'getting a second reader should throw a TypeError');
        assert_throws(new TypeError(), function() { rs.getReader(); }, 'getting a third reader should throw a TypeError');
    }, 'should not be able to obtain additional readers if we don\'t release the first lock');

    var test2 = async_test('cancel() should return a distinct rejected promise each time');
    test2.step(function() {
        var rs = factory();
        var promisesCount = 0;
        var allChecked = false;

        var cancelPromise1 = rs.cancel();
        var cancelPromise2 = rs.cancel();

        cancelPromise1.catch(test2.step_func(function(e) {
            assert_equals(e, error, 'first cancel() call should reject with the error');
            ++promisesCount;
        }));
        cancelPromise2.catch(test2.step_func(function(e) {
            assert_equals(e, error, 'second cancel() call should reject with the error');
            assert_equals(++promisesCount, 2);
            assert_true(allChecked);
            test2.done();
        }));
        assert_not_equals(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
        allChecked = true;
    });

    var test3 = async_test('reader cancel() should return a distinct rejected promise each time');
    test3.step(function() {
        var rs = factory();
        var reader = rs.getReader();
        var promisesCount = 0;
        var allChecked = false;

        var cancelPromise1 = reader.cancel();
        var cancelPromise2 = reader.cancel();

        cancelPromise1.catch(test3.step_func(function(e) {
            assert_equals(e, error, 'first cancel() call should reject with the error');
            ++promisesCount;
        }));
        cancelPromise2.catch(test3.step_func(function(e) {
            assert_equals(e, error, 'second cancel() call should reject with the error');
            assert_equals(++promisesCount, 2);
            assert_true(allChecked);
            test3.done();
        }));
        assert_not_equals(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
        allChecked = true;
    });
};

self.templatedRSEmptyReader = function (label, factory) {
    test(function() {
    }, 'Running templatedRSEmptyReader with ' + label);

    test(function() {
        var reader = factory().reader;

        assert_true('closed' in reader, 'has a closed property');
        assert_equals(typeof reader.closed.then, 'function', 'closed property is thenable');

        assert_equals(typeof reader.cancel, 'function', 'has a cancel method');
        assert_equals(typeof reader.read, 'function', 'has a read method');
        assert_equals(typeof reader.releaseLock, 'function', 'has a releaseLock method');
    }, 'instances have the correct methods and properties');

    test(function() {
        var stream = factory().stream;

        assert_true(stream.locked, 'locked getter should return true');
    }, 'locked should be true');

    var test1 = async_test('read() should never settle');
    test1.step(function() {
        var reader = factory().reader;

        reader.read().then(
            test1.step_func(function() { assert_unreached('read() should not fulfill'); }),
            test1.step_func(function() { assert_unreached('read() should not reject'); })
        );

        setTimeout(test1.step_func(function() { test1.done(); }), 1000);
    });

    var test2 = async_test('two read()s should both never settle');
    test2.step(function() {
        var reader = factory().reader;

        reader.read().then(
            test2.step_func(function() { assert_unreached('first read() should not fulfill'); }),
            test2.step_func(function() { assert_unreached('first read() should not reject'); })
        );

        reader.read().then(
            test2.step_func(function() { assert_unreached('second read() should not fulfill'); }),
            test2.step_func(function() { assert_unreached('second read() should not reject'); })
        );

        setTimeout(test2.step_func(function() { test2.done(); }), 1000);
    });

    test(function() {
        var reader = factory().reader;

        assert_not_equals(reader.read(), reader.read(), 'the promises returned should be distinct');
    }, 'read() should return distinct promises each time');

    test(function() {
        var stream = factory().stream;

        assert_throws(new TypeError(), function() { stream.getReader(); }, 'stream.getReader() should throw a TypeError');
    }, 'getReader() again on the stream should fail');

    var test3 = async_test('releasing the lock with pending read requests should throw but the read requests should stay pending');
    test3.step(function() {
        var streamAndReader = factory();
        var stream = streamAndReader.stream;
        var reader = streamAndReader.reader;

        reader.read().then(
            test3.step_func(function() { assert_unreached('first read() should not fulfill'); }),
            test3.step_func(function() { assert_unreached('first read() should not reject'); })
        );

        reader.read().then(
            test3.step_func(function() { assert_unreached('second read() should not fulfill'); }),
            test3.step_func(function() { assert_unreached('second read() should not reject'); })
        );

        reader.closed.then(
            test3.step_func(function() { assert_unreached('closed should not fulfill'); }),
            test3.step_func(function() { assert_unreached('closed should not reject'); })
        );

        assert_throws(new TypeError(), function() { reader.releaseLock(); }, 'releaseLock should throw a TypeError');

        assert_true(stream.locked, 'the stream should still be locked');

        setTimeout(test3.step_func(function() { test3.done(); }), 1000);
    });

    var test4 = async_test('releasing the lock should cause further read() calls to reject with a TypeError', { timeout: 50 });
    test4.step(function() {
        var promiseCalls = 0;
        var reader = factory().reader;

        reader.releaseLock();

        reader.read().catch(test4.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'first read() should reject with a TypeError');
            assert_equals(++promiseCalls, 1);
        }));
        reader.read().catch(test4.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'second read() should reject with a TypeError');
            assert_equals(++promiseCalls, 2);
            test4.done();
        }));
    });

    var test5 = async_test('releasing the lock should cause closed to reject', { timeout: 50 });
    test5.step(function() {
        var reader = factory().reader;

        var closedBefore = reader.closed;
        reader.releaseLock();
        var closedAfter = reader.closed;

        assert_equals(closedBefore, closedAfter, 'the closed promise should not change identity')
        closedBefore.catch(test5.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'reader.closed should reject with a TypeError');
            test5.done();
        }));
    });

    test(function() {
        var streamAndReader = factory();
        var stream = streamAndReader.stream;
        var reader = streamAndReader.reader;

        reader.releaseLock();
        assert_false(stream.locked, 'locked getter should return false');
    }, 'releasing the lock should cause locked to become false');

    var test6 = async_test('canceling via the reader should cause the reader to act closed');
    test6.step(function() {
        var reader = factory().reader;

        reader.cancel();
        reader.read().then(test6.step_func(function(r) {
            assert_object_equals(r, { value: undefined, done: true }, 'read()ing from the reader should give a done result');
            test6.done();
        }));
    });

    var test7 = async_test('canceling via the stream should fail');
    test7.step(function() {
        var stream = factory().stream;

        stream.cancel().catch(test7.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'cancel() should reject with a TypeError');
            test7.done();
        }));
    });
};

self.templatedRSClosedReader = function (label, factory) {
    test(function() {
    }, 'Running templatedRSClosedReader with ' + label);

    var  test1 = async_test('read() should fulfill with { value: undefined, done: true }');
    test1.step(function() {
        var reader = factory().reader;

        reader.read().then(
            test1.step_func(function(v) {
                assert_object_equals(v, { value: undefined, done: true }, 'read() should fulfill correctly');
                test1.done();
            }),
            test1.step_func(function() { assert_unreached('read() should not return a rejected promise'); })
        );
    });

    var test2 = async_test('read() multiple times should fulfill with { value: undefined, done: true }');
    test2.step(function() {
        var reader = factory().reader;
        var readCount = 0;

        reader.read().then(
            test2.step_func(function(v) {
                assert_object_equals(v, { value: undefined, done: true }, 'read() should fulfill correctly');
                ++readCount;
            }),
            test2.step_func(function() { assert_unreached('read() should not return a rejected promise'); })
        );
        reader.read().then(
            test2.step_func(function(v) {
                assert_object_equals(v, { value: undefined, done: true }, 'read() should fulfill correctly');
                assert_equals(++readCount, 2);
                test2.done();
            }),
            test2.step_func(function() { assert_unreached('read() should not return a rejected promise'); })
        );
    });

    var test3 = async_test('read() should work when used within another read() fulfill callback');
    test3.step(function() {
        var reader = factory().reader;

        reader.read().then(test3.step_func(function() { reader.read().then(test3.step_func(function() { test3.done('read() should fulfill'); })); }));
    });

    var test4 = async_test('closed should fulfill with undefined');
    test4.step(function() {
        var reader = factory().reader;

        reader.closed.then(
            test4.step_func(function(v) {
                assert_equals(v, undefined, 'reader closed should fulfill with undefined');
                test4.done();
            }),
            test4.step_func(function() { assert_unreached('reader closed should not reject'); })
        );
    });

    var test5 = async_test('releasing the lock should cause closed to reject and change identity');
    test5.step(function() {
        var promiseCalls = 0;
        var reader = factory().reader;

        var closedBefore = reader.closed;
        reader.releaseLock();
        var closedAfter = reader.closed;

        assert_not_equals(closedBefore, closedAfter, 'the closed promise should change identity')
        closedBefore.then(test5.step_func(function(v) {
            assert_equals(v, undefined, 'reader.closed acquired before release should fulfill');
            assert_equals(++promiseCalls, 1);
        }));
        closedAfter.catch(test5.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'reader.closed acquired after release should reject with a TypeError');
            assert_equals(++promiseCalls, 2);
            test5.done();
        }));
    });

    var test6 = async_test('cancel() should return a distinct fulfilled promise each time');
    test6.step(function() {
        var reader = factory().reader;
        var promiseCount = 0;
        var allChecked = false;

        var cancelPromise1 = reader.cancel();
        var cancelPromise2 = reader.cancel();
        var closedReaderPromise = reader.closed;

        cancelPromise1.then(test6.step_func(function(v) {
            assert_equals(v, undefined, 'first cancel() call should fulfill with undefined');
            ++promiseCount;
        }));
        cancelPromise2.then(test6.step_func(function(v) {
            assert_equals(v, undefined, 'second cancel() call should fulfill with undefined');
            assert_equals(++promiseCount, 2);
            assert_true(allChecked);
            test6.done();
        }));
        assert_not_equals(cancelPromise1, cancelPromise2, 'cancel() calls should return distinct promises');
        assert_not_equals(cancelPromise1, closedReaderPromise, 'cancel() promise 1 should be distinct from reader.closed');
        assert_not_equals(cancelPromise2, closedReaderPromise, 'cancel() promise 2 should be distinct from reader.closed');
        allChecked = true;
    });
};

self.templatedRSErroredReader = function (label, factory, error) {
    test(function() {
    }, 'Running templatedRSErroredReader with ' + label);

    var test1 = async_test('closed should reject with the error');
    test1.step(function() {
        var reader = factory().reader;

        reader.closed.then(
            test1.step_func(function() { assert_unreached('stream closed should not fulfill'); }),
            test1.step_func(function(r) {
                assert_equals(r, error, 'stream closed should reject with the error');
                test1.done();
            })
        );
    });

    var test2 = async_test('releasing the lock should cause closed to reject and change identity');
    test2.step(function() {
        var reader = factory().reader;

        var closedBefore = reader.closed;

        closedBefore.catch(test2.step_func(function(e) {
            assert_equals(e, error, 'reader.closed acquired before release should reject with the error');

            reader.releaseLock();
            var closedAfter = reader.closed;

            assert_not_equals(closedBefore, closedAfter, 'the closed promise should change identity');

            return closedAfter.catch(test2.step_func(function(e) {
                assert_throws(new TypeError(), function() { throw e; }, 'reader.closed acquired after release should reject with a TypeError');
                test2.done();
            }));
        })).catch(test2.step_func(function(e) { assert_unreached(e); }));
    });

    var test3 = async_test('read() should reject with the error');
    test3.step(function() {
        var reader = factory().reader;

        reader.read().then(
            test3.step_func(function() {
                assert_unreached('read() should not fulfill');
            }),
            test3.step_func(function(r) {
                assert_equals(r, error, 'read() should reject with the error');
                test3.done();
            })
        );
    });
};

self.templatedRSTwoChunksOpenReader = function (label, factory, chunks) {
    test(function() {
    }, 'Running templatedRSTwoChunksOpenReader with ' + label);

    var test1 = async_test('calling read() twice without waiting will eventually give both chunks');
    test1.step(function() {
        var reader = factory().reader;
        var promiseCount = 0;

        reader.read().then(test1.step_func(function(r) {
            assert_object_equals(r, { value: chunks[0], done: false }, 'first result should be correct');
            ++promiseCount;
        }));
        reader.read().then(test1.step_func(function(r) {
            assert_object_equals(r, { value: chunks[1], done: false }, 'second result should be correct');
            assert_equals(++promiseCount, 2);
            test1.done();
        }));
    });

    var test2 = async_test('calling read() twice with waiting will eventually give both chunks');
    test2.step(function() {
        var reader = factory().reader;

        reader.read().then(test2.step_func(function(r) {
            assert_object_equals(r, { value: chunks[0], done: false }, 'first result should be correct');

            return reader.read().then(test2.step_func(function(r) {
                assert_object_equals(r, { value: chunks[1], done: false }, 'second result should be correct');
                test2.done();
            }));
        })).catch(test2.step_func(function(e) { assert_unreached(e); }));
    });

    test(function() {
        var reader = factory().reader;

        assert_not_equals(reader.read(), reader.read(), 'the promises returned should be distinct');
    }, 'read() should return distinct promises each time');

    var test3 = async_test('cancel() after a read() should still give that single read result');
    test3.step(function() {
        var reader = factory().reader;
        var promiseCount = 0;

        reader.closed.then(test3.step_func(function(v) {
            assert_equals(v, undefined, 'reader closed should fulfill with undefined');
            ++promiseCount;
        }));

        reader.read().then(test3.step_func(function(r) {
            assert_object_equals(r, { value: chunks[0], done: false }, 'promise returned before cancellation should fulfill with a chunk');
            ++promiseCount;
        }));

        reader.cancel();

        reader.read().then(test3.step_func(function(r) {
            assert_object_equals(r, { value: undefined, done: true }, 'promise returned after cancellation should fulfill with an end-of-stream signal');
            assert_equals(++promiseCount, 3);
            test3.done();
        }))
    });
};

self.templatedRSTwoChunksClosedReader = function (label, factory, chunks) {
    test(function() {
    }, 'Running templatedRSTwoChunksClosedReader with ' + label);

    var test1 = async_test('third read(), without waiting, should give { value: undefined, done: true }');
    test1.step(function() {
        var reader = factory().reader;
        var promiseCount = 0;

        reader.read().then(test1.step_func(function(r) {
            assert_object_equals(r, { value: chunks[0], done: false }, 'first result should be correct');
            ++promiseCount;
        }));
        reader.read().then(test1.step_func(function(r) {
            assert_object_equals(r, { value: chunks[1], done: false }, 'second result should be correct');
            ++promiseCount;
        }));
        reader.read().then(test1.step_func(function(r) {
            assert_object_equals(r, { value: undefined, done: true }, 'third result should be correct');
            assert_equals(++promiseCount, 3);
            test1.done();
        }))
    });

    var test2 = async_test('third read, with waiting, should give { value: undefined, done: true }');
    test2.step(function() {
        var reader = factory().reader;

        reader.read().then(test2.step_func(function(r) {
            assert_object_equals(r, { value: chunks[0], done: false }, 'first result should be correct');

            return reader.read().then(test2.step_func(function(r) {
                assert_object_equals(r, { value: chunks[1], done: false }, 'second result should be correct');

                return reader.read().then(test2.step_func(function(r) {
                    assert_object_equals(r, { value: undefined, done: true }, 'third result should be correct');
                    test2.done();
                }));
            }));
        })).catch(test2.step_func(function(e) { assert_unreached(e); }));
    });

    var test3 = async_test('draining the stream via read() should cause the reader closed promise to fulfill, but locked stays true');
    test3.step(function() {
        var streamAndReader = factory();
        var stream = streamAndReader.stream;
        var reader = streamAndReader.reader;

        assert_true(stream.locked, 'stream should start locked');

        reader.closed.then(
            test3.step_func(function(v) {
                assert_equals(v, undefined, 'reader closed should fulfill with undefined');
                assert_true(stream.locked, 'stream should remain locked');
                test3.done();
            }),
            test3.step_func(function() { assert_unreached('reader closed should not reject'); })
        );

        reader.read();
        reader.read();
    });

    var test4 = async_test('releasing the lock after the stream is closed should cause locked to become false');
    test4.step(function() {
        var streamAndReader = factory();
        var stream = streamAndReader.stream;
        var reader = streamAndReader.reader;

        reader.closed.then(test4.step_func(function() {
            assert_true(stream.locked, 'the stream should start locked');
            reader.releaseLock(); // Releasing the lock after reader closed should not throw.
            assert_false(stream.locked, 'the stream should end unlocked');
            test4.done();
        }));

        reader.read();
        reader.read();
    });

    var test5 = async_test('releasing the lock should cause further read() calls to reject with a TypeError', { timeout: 50});
    test5.step(function() {
        var promiseCalls = 0;
        var reader = factory().reader;

        reader.releaseLock();

        reader.read().catch(test5.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'first read() should reject with a TypeError');
            assert_equals(++promiseCalls, 1);
        }));
        reader.read().catch(test5.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'second read() should reject with a TypeError');
            assert_equals(++promiseCalls, 2);
        }));
        reader.read().catch(test5.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, 'third read() should reject with a TypeError');
            assert_equals(++promiseCalls, 3);
            test5.done();
        }));
    });

    var test6 = async_test('reader\'s closed property always returns the same promise');
    test6.step(function() {
        var streamAndReader = factory();
        var stream = streamAndReader.stream;
        var reader = streamAndReader.reader;

        var readerClosed = reader.closed;

        assert_equals(reader.closed, readerClosed, 'accessing reader.closed twice in succession gives the same value');

        reader.read().then(test6.step_func(function() {
            assert_equals(reader.closed, readerClosed, 'reader.closed is the same after read() fulfills');

            reader.releaseLock();

            assert_equals(reader.closed, readerClosed, 'reader.closed is the same after releasing the lock');

            var newReader = stream.getReader();
            newReader.read();

            test6.done();
        }));

        assert_equals(reader.closed, readerClosed, 'reader.closed is the same after calling read()');
    });
};
