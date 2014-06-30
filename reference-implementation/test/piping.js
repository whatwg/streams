var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';
import passThroughTransform from './utils/pass-through-transform';

test('ReadableStream pipeTo should complete successfully upon asynchronous finish', t => {
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
    }
  };

  rs.pipeTo(dest);
});

test('Piping through a pass-through transform stream works', t => {
  t.plan(1);

  var output = sequentialReadableStream(5).pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});

test('Piping to a stream that is in the errored stated passes through the error as the cancellation reason', t => {
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

/*
DOES NOT WORK because if the source stays in "waiting" forever, it the codepath is never taken.

      } else if (source.state === 'waiting') {
        source.wait().then(fillDest, abortDest);


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
});*/

test('Piping to a stream that has been closed propagates a TypeError cancel backward', t => {
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

/*
DOES NOT WORK for the same reason

test('Piping to a stream and then closing it propagates a TypeError cancel backward', t => {
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

*/
