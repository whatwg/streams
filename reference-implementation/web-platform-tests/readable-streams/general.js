'use strict';

if (self.importScripts) {
  self.importScripts('../resources/rs-utils.js');
  self.importScripts('/resources/testharness.js');
}

test(function() {
    new ReadableStream(); // ReadableStream constructed with no parameters.
    new ReadableStream({ }); // ReadableStream constructed with an empty object as parameter.
    new ReadableStream(undefined); // ReadableStream constructed with undefined as parameter.
    var x;
    new ReadableStream(x) // ReadableStream constructed with an undefined variable as parameter.
}, 'ReadableStream can be constructed with no errors');

test(function() {
    assert_throws(new TypeError(), function() { new ReadableStream(null); }, 'constructor should throw when the source is null');
}, 'ReadableStream can\'t be constructed with garbage');

test(function() {
    var methods = ['cancel', 'constructor', 'getReader', 'pipeThrough', 'pipeTo', 'tee'];
    var properties = methods.concat(['locked']).sort();

    var rs = new ReadableStream();
    var proto = Object.getPrototypeOf(rs);

    assert_array_equals(Object.getOwnPropertyNames(proto).sort(), properties, 'should have all the correct methods');

    for (var m of methods) {
        var propDesc = Object.getOwnPropertyDescriptor(proto, m);
        assert_false(propDesc.enumerable, 'method should be non-enumerable');
        assert_true(propDesc.configurable, 'method should be configurable');
        assert_true(propDesc.writable, 'method should be writable');
        assert_equals(typeof rs[m], 'function', 'method should be a function');
    }

    var lockedPropDesc = Object.getOwnPropertyDescriptor(proto, 'locked');
    assert_false(lockedPropDesc.enumerable, 'locked should be non-enumerable');
    assert_equals(lockedPropDesc.writable, undefined, 'locked should not be a data property');
    assert_equals(typeof lockedPropDesc.get, 'function', 'locked should have a getter');
    assert_equals(lockedPropDesc.set, undefined, 'locked should not have a setter');
    assert_true(lockedPropDesc.configurable, 'locked should be configurable');

    assert_equals(rs.cancel.length, 1, 'cancel should have 1 parameter');
    assert_equals(rs.constructor.length, 0, 'constructor should have no parameters');
    assert_equals(rs.getReader.length, 0, 'getReader should have no parameters');
    assert_equals(rs.pipeThrough.length, 2, 'pipeThrough should have 2 parameters');
    assert_equals(rs.pipeTo.length, 1, 'pipeTo should have 1 parameter');
    assert_equals(rs.tee.length, 0, 'tee should have no parameters');
}, 'ReadableStream instances should have the correct list of properties');

test(function() {
    assert_throws(new TypeError(), function() {
        new ReadableStream({ start: 'potato'});
    }, 'constructor should throw when start is not a function');
}, 'ReadableStream constructor should throw for non-function start arguments');

test(function() {
    new ReadableStream({ cancel: '2'}); // Constructor should not throw when cancel is not a function.
}, 'ReadableStream constructor can get initial garbage as cancel argument');

test(function() {
    new ReadableStream({ pull: { } }); // Constructor should not throw when pull is not a function.
}, 'ReadableStream constructor can get initial garbage as pull argument');

test(function() {
    var startCalled = false;
    var source = {
        start: function(controller) {
            assert_equals(this, source, 'source is this during start');

            var methods = ['close', 'enqueue', 'error', 'constructor'];
            var properties = ['desiredSize'].concat(methods).sort();
            var proto = Object.getPrototypeOf(controller);

            assert_array_equals(Object.getOwnPropertyNames(proto).sort(), properties,
                                'the controller should have the right properties');

            for (var m of methods) {
                var propDesc = Object.getOwnPropertyDescriptor(proto, m);
                assert_equals(typeof controller[m], 'function', `should have a ${m} method`);
                assert_false(propDesc.enumerable, m + " should be non-enumerable");
                assert_true(propDesc.configurable, m + " should be configurable");
                assert_true(propDesc.writable, m + " should be writable");
            }

            var desiredSizePropDesc = Object.getOwnPropertyDescriptor(proto, 'desiredSize');
            assert_false(desiredSizePropDesc.enumerable, 'desiredSize should be non-enumerable');
            assert_equals(desiredSizePropDesc.writable, undefined, 'desiredSize should not be a data property');
            assert_equals(typeof desiredSizePropDesc.get, 'function', 'desiredSize should have a getter');
            assert_equals(desiredSizePropDesc.set, undefined, 'desiredSize should not have a setter');
            assert_true(desiredSizePropDesc.configurable, 'desiredSize should be configurable');

            assert_equals(controller.close.length, 0, 'close should have no parameters');
            assert_equals(controller.constructor.length, 1, 'constructor should have 1 parameter');
            assert_equals(controller.enqueue.length, 1, 'enqueue should have 1 parameter');
            assert_equals(controller.error.length, 1, 'error should have 1 parameter');

            startCalled = true;
        }
    };

    new ReadableStream(source);
    assert_true(startCalled);
}, 'ReadableStream start should be called with the proper parameters');

test(function() {
    var startCalled = false;
    var source = {
        start: function(controller) {
            var properties = ['close', 'constructor', 'desiredSize', 'enqueue', 'error'];
            assert_array_equals(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort(), properties,
                                'prototype should have the right properties');
            controller.test = '';
            assert_array_equals(Object.getOwnPropertyNames(Object.getPrototypeOf(controller)).sort(), properties,
                                'prototype should still have the right properties');
            assert_not_equals(Object.getOwnPropertyNames(controller).indexOf('test'), -1,
                              '"test" should be a property of the controller');

            startCalled = true;
        }
    };

    var rs = new ReadableStream(source);
    assert_true(startCalled);
}, 'ReadableStream start controller parameter should be extensible');

promise_test(t => {
    function SimpleStreamSource() {
    }
    var resolve;
    var promise = new Promise(r => resolve = r);
    SimpleStreamSource.prototype = {
        start: resolve
    };

    new ReadableStream(new SimpleStreamSource());
    return promise;
}, 'ReadableStream should be able to call start method within prototype chain of its source');

promise_test(t => {
    var readCalled = false;
    var rs = new ReadableStream({
        start: function(c) {
            return new Promise((resolve, reject) => {
                setTimeout(() => {
                    try {
                        c.enqueue('a');
                        c.close();
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                }, 5);
            });
        },
    });

    var reader = rs.getReader();
    return reader.read().then(r => {
        assert_object_equals(r, { value: 'a', done: false }, 'value read should be the one enqueued');
        return reader.closed;
    });
}, 'ReadableStream start should be able to return a promise');

promise_test(t => {
    var theError = new Error('rejected!');
    var rs = new ReadableStream({
        start: function() {
            return new Promise((resolve, reject) => {
                setTimeout(() => reject(theError), 1);
            });
        },
    });

    return rs.getReader().closed.then(() => {
        assert_unreached('closed promise should be rejected');
    }, e => {
        assert_equals(e, theError, 'promise should be rejected with the same error');
    });
}, 'ReadableStream start should be able to return a promise and reject it');

promise_test(t => {
    var readCalls = 0;
    var objects = [
    { potato: 'Give me more!'},
    'test',
    1
    ];

    var rs = new ReadableStream({
        start: function(c) {
            for (var o of objects) {
                c.enqueue(o);
            }
            c.close();
        }
    });

    var reader = rs.getReader();
    var promises = [reader.read(), reader.read(), reader.read(), reader.closed];
    return Promise.all(promises).then(r => {
        assert_object_equals(r[0], { value: objects[0], done: false }, 'value read should be the one enqueued');
        assert_object_equals(r[1], { value: objects[1], done: false }, 'value read should be the one enqueued');
        assert_object_equals(r[2], { value: objects[2], done: false }, 'value read should be the one enqueued');
    });
}, 'ReadableStream should be able to enqueue different objects.');

promise_test(t => {
    var error = new Error('pull failure');
    var rs = new ReadableStream({
        pull: function() {
            return Promise.reject(error);
        }
    });

    var reader = rs.getReader();

    var closed = false;
    var read = false;

    return Promise.all([
        reader.closed.then(() => {
            assert_unreached('closed should be rejected');
        }, e => {
            closed = true;
            assert_true(read);
            assert_equals(e, error, 'closed should be rejected with the thrown error');
        }),
        reader.read().then(() => {
            assert_unreached('read() should be rejected');
        }, e => {
            read = true;
            assert_false(closed);
            assert_equals(e, error, 'read() should be rejected with the thrown error');
        })
    ]);
}, 'ReadableStream: if pull rejects, it should error the stream');

promise_test(t => {
    var pullCount = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function() {
            return startPromise;
        },
        pull: function() {
            pullCount++;
        }
    });

    return startPromise.then(() => {
        assert_equals(pullCount, 1, 'pull should be called once start finishes');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(pullCount, 1, 'pull should be called exactly once');
    });

}, 'ReadableStream: should only call pull once upon starting the stream');

promise_test(t => {
    var pullCount = 0;
    var rs = new ReadableStream({
        start: function() {},
        pull: function(c) {
            // Don't enqueue immediately after start. We want the stream to be empty when we call .read() on it.
            if (pullCount > 0) {
                c.enqueue(pullCount);
            }
            ++pullCount;
        }
    });

    return new Promise(resolve => setTimeout(resolve, 1)).then(() => {
        assert_equals(pullCount, 1, 'pull should be called once start finishes');

        var reader = rs.getReader();
        var read = reader.read();
        assert_equals(pullCount, 2, 'pull should be called when read is called');
        return read;
    }).then(result => {
        assert_equals(pullCount, 3, 'pull should be called again in reaction to calling read');
        assert_object_equals(result, { value: 1, done: false }, 'the result read should be the one enqueued');
    });
}, 'ReadableStream: should call pull when trying to read from a started, empty stream');

promise_test(t => {
    var pullCount = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            c.enqueue('a');
            return startPromise;
        },
        pull: function() {
            pullCount++;
        }
    });

    var read = rs.getReader().read();
    assert_equals(pullCount, 0, 'calling read() should not cause pull to be called yet');
    return startPromise.then(() => {
        assert_equals(pullCount, 1, 'pull should be called once start finishes');
        return read;
    }).then(r => {
        assert_object_equals(r, { value: 'a', done: false }, 'first read() should return first chunk');
        assert_equals(pullCount, 1, 'pull should not have been called again');
        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(pullCount, 1, 'pull should be called exactly once');
    });

}, 'ReadableStream: should only call pull once on a non-empty stream read from before start fulfills');

promise_test(t => {
    var pullCount = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            c.enqueue('a');
            return startPromise;
        },
        pull: function() {
            pullCount++;
        }
    });

    return startPromise.then(function() {
        assert_equals(pullCount, 0, 'pull should not be called once start finishes, since the queue is full');

        var read = rs.getReader().read();
        assert_equals(pullCount, 1, 'calling read() should cause pull to be called immediately');
        return read;
    }).then(function(r) {
        assert_object_equals(r, { value: 'a', done: false }, 'first read() should return first chunk');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(pullCount, 1, 'pull should be called exactly once');
    });
}, 'ReadableStream: should only call pull once on a non-empty stream read from after start fulfills');

promise_test(t => {
    var pullCount = 0;
    var controller;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            controller = c;
            return startPromise;
        },
        pull: function() {
            ++pullCount;
        }
    });

    var reader = rs.getReader();
    return startPromise.then(function() {
        assert_equals(pullCount, 1, 'pull should have been called once by the time the stream starts');

        controller.enqueue('a');
        assert_equals(pullCount, 1, 'pull should not have been called again after enqueue');

        return reader.read();
    }).then(function() {
        assert_equals(pullCount, 2, 'pull should have been called again after read');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(pullCount, 2, 'pull should be called exactly twice');
    });
}, 'ReadableStream: should call pull in reaction to read()ing the last chunk, if not draining');

promise_test(t => {
    var pullCount = 0;
    var controller;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            controller = c;
            return startPromise;
        },
        pull: function() {
            ++pullCount;
        }
    });

    var reader = rs.getReader();

    return startPromise.then(function() {
        assert_equals(pullCount, 1, 'pull should have been called once by the time the stream starts');

        controller.enqueue('a');
        assert_equals(pullCount, 1, 'pull should not have been called again after enqueue');

        controller.close();

        return reader.read();
    }).then(function() {
        assert_equals(pullCount, 1, 'pull should not have been called a second time after read');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(pullCount, 1, 'pull should be called exactly once');
    });
}, 'ReadableStream: should not call pull() in reaction to read()ing the last chunk, if draining');

promise_test(t => {
    var resolve;
    var returnedPromise;
    var timesCalled = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function() {
            return startPromise;
        },
        pull: function(c) {
            c.enqueue(++timesCalled);
            returnedPromise = new Promise(function(r) { resolve = r; });
            return returnedPromise;
        }
    });
    var reader = rs.getReader();

    return startPromise.then(function() {
        return reader.read();
    }).then(function(result1) {
        assert_equals(timesCalled, 1,
                      'pull should have been called once after start, but not yet have been called a second time');
        assert_object_equals(result1, { value: 1, done: false }, 'read() should fulfill with the enqueued value');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        assert_equals(timesCalled, 1, 'after 10 ms, pull should still only have been called once');

        resolve();
        return returnedPromise;
    }).then(() => {
        assert_equals(timesCalled, 2,
                      'after the promise returned by pull is fulfilled, pull should be called a second time');
    });
}, 'ReadableStream: should not call pull until the previous pull call\'s promise fulfills');

promise_test(t => {
    var timesCalled = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            c.enqueue('a');
            c.enqueue('b');
            c.enqueue('c');
            return startPromise;
        },
        pull() {
            ++timesCalled;
        }
    },
    {
        size: function() {
            return 1;
        },
        highWaterMark: Infinity
    });
    var reader = rs.getReader();

    return startPromise.then(function() {
        return reader.read();
    }).then(function(result1) {
        assert_object_equals(result1, { value: 'a', done: false }, 'first chunk should be as expected');

        return reader.read();
    }).then(function(result2) {
        assert_object_equals(result2, { value: 'b', done: false }, 'second chunk should be as expected');

        return reader.read();
    }).then(function(result3) {
        assert_object_equals(result3, { value: 'c', done: false }, 'third chunk should be as expected');

        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        // Once for after start, and once for every read.
        assert_equals(timesCalled, 4, 'pull() should be called exactly four times');
    });
}, 'ReadableStream: should pull after start, and after every read');

promise_test(t => {
    var timesCalled = 0;
    var startPromise = Promise.resolve();
    var rs = new ReadableStream({
        start: function(c) {
            c.enqueue('a');
            c.close();
            return startPromise;
        },
        pull: function() {
            ++timesCalled;
        }
    });

    var reader = rs.getReader();
    return startPromise.then(function() {
        assert_equals(timesCalled, 0, 'after start finishes, pull should not have been called');

        return reader.read();
    }).then(function() {
        assert_equals(timesCalled, 0, 'reading should not have triggered a pull call');

        return reader.closed;
    }).then(function() {
        assert_equals(timesCalled, 0, 'stream should have closed with still no calls to pull');
    });
}, 'ReadableStream: should not call pull after start if the stream is now closed');

promise_test(t => {
    var timesCalled = 0;
    var resolve;
    var ready = new Promise(r => resolve = r);
    var rs = new ReadableStream({
        start: function() {},
        pull: function(c) {
            c.enqueue(++timesCalled);

            if (timesCalled == 4) {
                resolve();
            }
        }
    },
    {
        size: function() {
            return 1;
        },
        highWaterMark: 4
    });

    return ready.then(() => {
        return new Promise(resolve => setTimeout(resolve, 10));
    }).then(() => {
        // after start: size = 0, pull()
        // after enqueue(1): size = 1, pull()
        // after enqueue(2): size = 2, pull()
        // after enqueue(3): size = 3, pull()
        // after enqueue(4): size = 4, do not pull
        assert_equals(timesCalled, 4, 'pull() should have been called four times');
    });
}, 'ReadableStream: should call pull after enqueueing from inside pull (with no read requests), if strategy allows');

promise_test(t => {
    var pullCalled = false;
    var rs = new ReadableStream({
        pull: function(c) {
            pullCalled = true;
            c.close();
        }
    });

    var reader = rs.getReader();
    return reader.closed.then(function() {
        assert_true(pullCalled);
    });
}, 'ReadableStream pull should be able to close a stream.');

test(function() {
    var startCalled = false;
    var rs = new ReadableStream({
        start: function(c) {
            assert_equals(c.enqueue('a'), undefined, 'the first enqueue should return undefined');
            c.close();

            assert_throws(new TypeError(''), function() { c.enqueue('b'); }, 'enqueue after close should throw a TypeError');
            startCalled = true;
        }
    });
    assert_true(startCalled);
}, 'ReadableStream: enqueue should throw when the stream is readable but draining');

test(function() {
    var startCalled = false;
    var rs = new ReadableStream({
        start: function(c) {
            c.close();

            assert_throws(new TypeError(), function() { c.enqueue('a'); }, 'enqueue after close should throw a TypeError');
            startCalled = true;
        }
    });
    assert_true(startCalled);
}, 'ReadableStream: enqueue should throw when the stream is closed');

test(function() {
    var startCalled = false;
    var expectedError = new Error('i am sad');
    var rs = new ReadableStream({
        start: function(c) {
            c.error(expectedError);

            assert_throws(expectedError, function() { c.enqueue('a'); }, 'enqueue after error should throw that error');
            startCalled = true;
        }
    });
    assert_true(startCalled);
}, 'ReadableStream: enqueue should throw the stored error when the stream is errored');

promise_test(t => {
    var startCalled = 0;
    var pullCalled = 0;
    var cancelCalled = 0;

    function Source() {
    }

    Source.prototype = {
        start: function(c) {
            startCalled++;
            assert_equals(this, theSource, 'start() should be called with the correct this');
            c.enqueue('a');
        },

        pull: function() {
            pullCalled++;
            assert_equals(this, theSource, 'pull() should be called with the correct this');
        },

        cancel: function() {
            cancelCalled++;
            assert_equals(this, theSource, 'cancel() should be called with the correct this');
        },
    };

    var theSource = new Source();
    theSource.debugName = 'the source object passed to the constructor'; // makes test failures easier to diagnose
    var rs = new ReadableStream(theSource);

    var reader = rs.getReader();
    return reader.read().then(function() {
        reader.releaseLock();
        rs.cancel();
        assert_equals(startCalled, 1);
        assert_equals(pullCalled, 1);
        assert_equals(cancelCalled, 1);
        return rs.getReader().closed;
    });
}, 'ReadableStream: should call underlying source methods as methods');

test(function() {
    var startCalled = false;
    new ReadableStream({
        start: function(c) {
            assert_equals(c.desiredSize, 1);
            c.enqueue('a');
            assert_equals(c.desiredSize, 0);
            c.enqueue('b');
            assert_equals(c.desiredSize, -1);
            c.enqueue('c');
            assert_equals(c.desiredSize, -2);
            c.enqueue('d');
            assert_equals(c.desiredSize, -3);
            c.enqueue('e');
            startCalled = true;
        }
    });
    assert_true(startCalled);
}, 'ReadableStream strategies: the default strategy should give desiredSize of 1 to start, decreasing by 1 per enqueue');

promise_test(t => {
    var controller;
    var rs = new ReadableStream({
        start: function(c) {
            controller = c;
        }
    });
    var reader = rs.getReader();

    assert_equals(controller.desiredSize, 1, 'desiredSize should start at 1');
    controller.enqueue('a');
    assert_equals(controller.desiredSize, 0, 'desiredSize should decrease to 0 after first enqueue');

    return reader.read().then(function(result1) {
        assert_object_equals(result1, { value: 'a', done: false }, 'first chunk read should be correct');

        assert_equals(controller.desiredSize, 1, 'desiredSize should go up to 1 after the first read');
        controller.enqueue('b');
        assert_equals(controller.desiredSize, 0, 'desiredSize should go down to 0 after the second enqueue');

        return reader.read();
    }).then(function(result2) {
        assert_object_equals(result2, { value: 'b', done: false }, 'second chunk read should be correct');

        assert_equals(controller.desiredSize, 1, 'desiredSize should go up to 1 after the second read');
        controller.enqueue('c');
        assert_equals(controller.desiredSize, 0, 'desiredSize should go down to 0 after the third enqueue');

        return reader.read();
    }).then(function(result3) {
        assert_object_equals(result3, { value: 'c', done: false }, 'third chunk read should be correct');

        assert_equals(controller.desiredSize, 1, 'desiredSize should go up to 1 after the third read');
        controller.enqueue('d');
        assert_equals(controller.desiredSize, 0, 'desiredSize should go down to 0 after the fourth enqueue');
    });
}, 'ReadableStream strategies: the default strategy should continue giving desiredSize of 1 if the chunks are read immediately');

promise_test(t => {
    var randomSource = new RandomPushSource(8);

    var rs = new ReadableStream({
        start: function(c) {
            assert_equals(typeof c, 'object', 'c should be an object in start');
            assert_equals(typeof c.enqueue, 'function', 'enqueue should be a function in start');
            assert_equals(typeof c.close, 'function', 'close should be a function in start');
            assert_equals(typeof c.error, 'function', 'error should be a function in start');

            randomSource.ondata = t.step_func(function(chunk) {
                if (!c.enqueue(chunk) <= 0) {
                    randomSource.readStop();
                }
            });

            randomSource.onend = c.close.bind(c);
            randomSource.onerror = c.error.bind(c);
        },

        pull: function(c) {
            assert_equals(typeof c, 'object', 'c should be an object in pull');
            assert_equals(typeof c.enqueue, 'function', 'enqueue should be a function in pull');
            assert_equals(typeof c.close, 'function', 'close should be a function in pull');

            randomSource.readStart();
        }
    });

    return readableStreamToArray(rs).then(function(chunks) {
        assert_equals(chunks.length, 8, '8 chunks should be read');
        for (var i = 0; i < chunks.length; i++) {
            assert_equals(chunks[i].length, 128, 'chunk should have 128 bytes');
        }
    });
}, 'ReadableStream integration test: adapting a random push source');

promise_test(t => {
    var rs = sequentialReadableStream(10);

    return readableStreamToArray(rs).then(function(chunks) {
        assert_true(rs.source.closed, 'source should be closed after all chunks are read');
        assert_array_equals(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');
    });
}, 'ReadableStream integration test: adapting a sync pull source');

promise_test(t => {
    var rs = sequentialReadableStream(10, { async: true });

    return readableStreamToArray(rs).then(function(chunks) {
        assert_true(rs.source.closed, 'source should be closed after all chunks are read');
        assert_array_equals(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'the expected 10 chunks should be read');
    });
}, 'ReadableStream integration test: adapting an async pull source');

done();
