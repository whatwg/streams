var test = require('tape');

import WritableStream from '../lib/writable-stream';

test('Aborting a WritableStream immediately prevents future writes', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk, done) {
      chunks.push(chunk);
      done();
    }
  });

  ws.abort();
  ws.write(1);
  ws.write(2);

  t.deepEqual(chunks, [], 'no chunks are written');
  t.end();
});

test('Aborting a WritableStream prevents further writes after any that are in progress', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk, done) {
      chunks.push(chunk);
      setTimeout(done, 50);
    }
  });

  ws.write(1);
  ws.write(2);
  ws.write(3);
  ws.abort();
  ws.write(4);
  ws.write(5);

  setTimeout(function () {
    t.deepEqual(chunks, [1], 'only the single in-progress chunk gets written');
    t.end();
  }, 200);
});
