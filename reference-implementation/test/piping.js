var test = require('tape');

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
