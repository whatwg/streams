'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;
var RandomPushStream = require('./lib/random-push-stream.js');

require('../index.js');

function readableStreamToArray(readable) {
  return new Promise(function (resolve, reject) {
    var chunks = [];

    readable.closed.then(function () { resolve(chunks); }, reject);

    function pump() {
      while (readable.state === 'readable') {
        var data = readable.read();
        chunks.push(data);
      }

      if (readable.state === 'waiting') readable.wait().then(pump);
    }

    pump();
  });
}

test('BaseReadableStream adapting a push stream', function (t) {
  /*global BaseReadableStream*/
  var basic;

  t.doesNotThrow(function () { basic = new BaseReadableStream(); },
                 'BaseReadableStream is available');

  var pullChecked = false;
  var randomStream = new RandomPushStream(8);

  basic = new BaseReadableStream({
    start : function start(push, close, error) {
      t.equal(typeof push,  'function', 'push is a function in start');
      t.equal(typeof close, 'function', 'close is a function in start');
      t.equal(typeof error, 'function', 'error is a function in start');

      randomStream.ondata = function (chunk) {
        if (!push(chunk)) randomStream.readStop();
      };

      randomStream.onend = close;
      randomStream.onerror = error;
    },

    pull : function pull(push, close, error) {
      if (!pullChecked) {
        pullChecked = true;
        t.equal(typeof push, 'function', 'push is a function in pull');
        t.equal(typeof close, 'function', 'close is a function in pull');
        t.equal(typeof error, 'function', 'error is a function in pull');
      }

      randomStream.readStart();
    }
  });

  t.equal(basic.state, 'waiting', 'stream starts out waiting');
  t.equal(typeof basic.read, 'function', 'stream has a read function');
  t.equal(typeof basic.wait, 'function', 'stream has a wait function');
  t.ok(basic.closed, 'stream has closed promise');
  t.ok(basic.closed.then, 'stream has closed promise that is thenable');

  readableStreamToArray(basic).then(function (chunks) {
    t.equal(basic.state, 'closed', 'should be closed');
    t.equal(chunks.length, 8, 'got the expected 8 chunks');
    for (var i = 0; i < chunks.length; i++) {
      t.equal(chunks[i].length, 128, 'each chunk has 128 bytes');
    }

    t.end();
  });
});
