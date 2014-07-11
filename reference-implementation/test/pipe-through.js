var test = require('tape');

import sequentialReadableStream from './utils/sequential-rs';
import duckTypedPassThroughTransform from './utils/duck-typed-pass-through-transform';
import readableStreamToArray from './utils/readable-stream-to-array';

test('Piping through a duck-typed pass-through transform stream works', t => {
  t.plan(1);

  var output = sequentialReadableStream(5).pipeThrough(duckTypedPassThroughTransform());

  readableStreamToArray(output).then(chunks => t.deepEqual(chunks, [1, 2, 3, 4, 5]));
});
