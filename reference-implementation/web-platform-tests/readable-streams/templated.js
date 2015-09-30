'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/rs-test-templates.js');
}

// Run the readable stream test templates against readable streams created directly using the constructor

var theError = new Error('boo!');
var chunks = ['a', 'b'];

templatedRSEmpty('ReadableStream (empty)', function() {
    return new ReadableStream();
});

templatedRSEmptyReader('ReadableStream (empty) reader', function() {
    return streamAndDefaultReader(new ReadableStream());
});

templatedRSClosed('ReadableStream (closed via call in start)', function() {
    return new ReadableStream({
        start: function(c) {
            c.close();
        }
    });
});

templatedRSClosedReader('ReadableStream reader (closed before getting reader)', function() {
    var controller;
    var stream = new ReadableStream({
        start: function(c) {
            controller = c;
        }
    });
    controller.close();
    var result = streamAndDefaultReader(stream);
    return result;
});

templatedRSClosedReader('ReadableStream reader (closed after getting reader)', function() {
    var controller;
    var stream = new ReadableStream({
        start: function(c) {
            controller = c;
        }
    });
    var result = streamAndDefaultReader(stream);
    controller.close();
    return result;
});

templatedRSClosed('ReadableStream (closed via cancel)', function() {
    var stream = new ReadableStream();
    stream.cancel();
    return stream;
});

templatedRSClosedReader('ReadableStream reader (closed via cancel after getting reader)', function() {
    var stream = new ReadableStream();
    var result = streamAndDefaultReader(stream);
    result.reader.cancel();
    return result;
});

var theError = new Error('boo!');

templatedRSErrored('ReadableStream (errored via call in start)', function() {
    return new ReadableStream({
        start: function(c) {
            c.error(theError);
        }
    })},
    theError
);

templatedRSErroredSyncOnly('ReadableStream (errored via call in start)', function() {
    return new ReadableStream({
        start: function(c) {
            c.error(theError);
        }
    })},
    theError
);

templatedRSErrored('ReadableStream (errored via returning a rejected promise in start)', function() {
    return new ReadableStream({
        start: function() {
            return Promise.reject(theError);
        }
    })},
    theError
);

templatedRSErroredReader('ReadableStream (errored via returning a rejected promise in start) reader', function() {
    return streamAndDefaultReader(new ReadableStream({
        start: function() {
            return Promise.reject(theError);
        }
    }))},
    theError
);

templatedRSErroredReader('ReadableStream reader (errored before getting reader)', function() {
    var controller;
    var stream = new ReadableStream({
        start: function(c) {
            controller = c;
        }
    });
    controller.error(theError);
    return streamAndDefaultReader(stream);
}, theError);

templatedRSErroredReader('ReadableStream reader (errored after getting reader)', function() {
    var controller;
    var result = streamAndDefaultReader(new ReadableStream({
        start: function(c) {
            controller = c;
        }
    }));
    controller.error(theError);
    return result;
}, theError);

var chunks = ['a', 'b'];

templatedRSTwoChunksOpenReader('ReadableStream (two chunks enqueued, still open) reader', function() {
    return streamAndDefaultReader(new ReadableStream({
        start: function(c) {
            c.enqueue(chunks[0]);
            c.enqueue(chunks[1]);
        }
    }))},
    chunks
);

templatedRSTwoChunksClosedReader('ReadableStream (two chunks enqueued, then closed) reader', function() {
    var doClose;
    var stream = new ReadableStream({
        start: function(c) {
            c.enqueue(chunks[0]);
            c.enqueue(chunks[1]);
            doClose = c.close.bind(c);
        }
    });
    var result = streamAndDefaultReader(stream);
    doClose();
    return result;
}, chunks);

function streamAndDefaultReader(stream) {
  return { stream: stream, reader: stream.getReader() };
}

done();
