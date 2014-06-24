var test = require('tape');

import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';
import passThroughTransform from './utils/pass-through-transform';

test('ReadableStream pipeTo should complete successfully upon asynchronous finish', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var stream = sequentialReadableStream(5, { async: true });

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

  var output = sequentialReadableStream(5).pipeThrough(passThroughTransform());

  readableStreamToArray(output).then(function (chunks) {
    t.deepEqual(chunks, [1, 2, 3, 4, 5]);
  });
});
