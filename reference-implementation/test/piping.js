'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;
var readableStreamToArray = require('./lib/readable-stream-to-array.js');
var sequentialBaseReadableStream = require('./lib/sequential-brs.js');
var passThroughTransform = require('./lib/pass-through-transform.js');

require('../index.js');

test('BaseReadableStream pipeTo should complete successfully upon asynchronous finish', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var stream = sequentialBaseReadableStream(5, { async: true });

  var dataWritten = [];
  var dest = {
    state: 'writable',
    write: function (value) {
      dataWritten.push(value);
      return Promise.resolve();
    },
    close: function () {
      t.deepEqual(dataWritten, [1, 2, 3, 4, 5]);
      return Promise.resolve();
    },
    abort: function () {
      t.fail('Should not call abort');
    }
  };

  stream.pipeTo(dest);
});

test('Piping through a pass-through transform stream works', function (t) {
  t.plan(1);

  var output = sequentialBaseReadableStream(5).pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(function (chunks) {
    t.deepEqual(chunks, [1, 2, 3, 4, 5]);
  });
});

test('Piping through a synchronous pass-through transform stream never causes backpressure: sync push', function (t) {
  t.plan(5);

  var rs = new BaseReadableStream({
    start : function (push, close) {
      Promise.resolve().then(function () {
        // Using promises for a portable nextTick, so that this code runs after the pipe chain is established.
        t.equal(push(1), true);
        t.equal(push(2), true);
        t.equal(push(3), true);
        t.equal(push(4), true);
        close();
      });
    }
  });

  var output = rs.pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(function (chunks) {
    t.deepEqual(chunks, [1, 2, 3, 4]);
  });
});
