'use strict';

if (self.importScripts) {
  self.importScripts('../resources/test-utils.js');
  self.importScripts('/resources/testharness.js');
}

var ReadableStreamReader;
var ReadableStreamController;

test(function() {
    // It's not exposed globally, but we test a few of its properties here.
    ReadableStreamReader = (new ReadableStream()).getReader().constructor;
}, 'Can get the ReadableStreamReader constructor indirectly');

test(function() {
    // It's not exposed globally, but we test a few of its properties here.
    new ReadableStream({
        start: function(c) {
            ReadableStreamController = c.constructor;
        }
    });
}, 'Can get the ReadableStreamController constructor indirectly');

function fakeReadableStream() {
    return {
        cancel: function(reason) { return Promise.resolve(); },
        getReader: function() { return new ReadableStreamReader(new ReadableStream()); },
        pipeThrough: function(obj, options) { return obj.readable; },
        pipeTo: function() { return Promise.resolve(); },
        tee: function() { return [realReadableStream(), realReadableStream()]; }
    };
}

function realReadableStream() {
    return new ReadableStream();
}

function fakeReadableStreamReader() {
    return {
        get closed() { return Promise.resolve(); },
        cancel: function(reason) { return Promise.resolve(); },
        read: function() { return Promise.resolve({ value: undefined, done: true }); },
        releaseLock: function() { return; }
    };
}

function fakeReadableStreamController() {
    return {
        close: function() { },
        enqueue: function(chunk) { },
        error: function(e) { }
    };
}

var test1 = async_test('ReadableStream.prototype.cancel enforces a brand check');
test1.step(function() {
    methodRejects(test1, ReadableStream.prototype, 'cancel', fakeReadableStream(), true);
});

test(function() {
    methodThrows(ReadableStream.prototype, 'getReader', fakeReadableStream());
}, 'ReadableStream.prototype.getReader enforces a brand check');

test(function() {
    var pipeToArguments;
    var thisValue = {
        pipeTo: function() {
            pipeToArguments = arguments;
        }
    };

    var input = { readable: {}, writable: {} };
    var options = {};
    var result = ReadableStream.prototype.pipeThrough.call(thisValue, input, options);

    assert_array_equals(pipeToArguments, [input.writable, options], 'correct arguments should be passed to thisValue.pipeTo');
    assert_equals(result, input.readable, 'return value should be the passed readable property');
}, 'ReadableStream.prototype.pipeThrough works generically on its this and its arguments');

test(function() {
    methodThrows(ReadableStream.prototype, 'tee', fakeReadableStream());
}, 'ReadableStream.prototype.tee enforces a brand check');

test(function() {
    assert_throws(new TypeError(), function() { new ReadableStreamReader(fakeReadableStream()); }, 'Constructing a ReadableStreamReader should throw');
}, 'ReadableStreamReader enforces a brand check on its argument');

var test2 = async_test('ReadableStreamReader.prototype.closed enforces a brand check');
test2.step(function() {
    getterRejects(test2, ReadableStreamReader.prototype, 'closed', fakeReadableStreamReader());
    getterRejects(test2, ReadableStreamReader.prototype, 'closed', realReadableStream(), true);
});

var test3 = async_test('ReadableStreamReader.prototype.cancel enforces a brand check');
test3.step(function() {
    methodRejects(test3, ReadableStreamReader.prototype, 'cancel', fakeReadableStreamReader());
    methodRejects(test3, ReadableStreamReader.prototype, 'cancel', realReadableStream(), true);
});

var test4 = async_test('ReadableStreamReader.prototype.read enforces a brand check');
test4.step(function() {
    methodRejects(test4, ReadableStreamReader.prototype, 'read', fakeReadableStreamReader());
    methodRejects(test4, ReadableStreamReader.prototype, 'read', realReadableStream(), true);
});

var test5 = async_test('ReadableStreamReader.prototype.read enforces a brand check');
test5.step(function() {
    methodRejects(test5, ReadableStreamReader.prototype, 'read', fakeReadableStreamReader());
    methodRejects(test5, ReadableStreamReader.prototype, 'read', realReadableStream(), true);
});

test(function() {
    methodThrows(ReadableStreamReader.prototype, 'releaseLock', fakeReadableStreamReader());
    methodThrows(ReadableStreamReader.prototype, 'releaseLock', realReadableStream());
}, 'ReadableStreamReader.prototype.releaseLock enforces a brand check');

test(function() {
    assert_throws(new TypeError(), function() { new ReadableStreamController(fakeReadableStream()); }, 'Constructing a ReadableStreamController should throw');
}, 'ReadableStreamController enforces a brand check on its argument');

test(function() {
    assert_throws(new TypeError(), function() { new ReadableStreamController(realReadableStream()); }, 'Constructing a ReadableStreamController should throw');
}, 'ReadableStreamController can\'t be given a fully-constructed ReadableStream');

test(function() {
  methodThrows(ReadableStreamController.prototype, 'close', fakeReadableStreamController());
}, 'ReadableStreamController.prototype.close enforces a brand check');

test(function() {
  methodThrows(ReadableStreamController.prototype, 'enqueue', fakeReadableStreamController());
}, 'ReadableStreamController.prototype.enqueue enforces a brand check');

test(function() {
  methodThrows(ReadableStreamController.prototype, 'error', fakeReadableStreamController());
}, 'ReadableStreamController.prototype.error enforces a brand check');

done();
