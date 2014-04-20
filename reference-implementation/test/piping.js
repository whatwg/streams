'use strict';

var test = require('tape');
var readableStreamToArray = require('./lib/readable-stream-to-array.js');
var sequentialBaseReadableStream = require('./lib/sequential-brs.js');
var passThroughTransform = require('./lib/pass-through-transform.js');

require('../index.js');

test('Piping through a pass-through transform stream works', function (t) {
  t.plan(1);

  var output = sequentialBaseReadableStream(5).pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(function (chunks) {
    t.deepEqual(chunks, [1, 2, 3, 4, 5]);
  });
});
