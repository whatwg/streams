'use strict';

var test = require('tap').test;
var Promise = require('es6-promise').Promise;

require('../index.js');

// http://stackoverflow.com/questions/1349404/generate-a-string-of-5-random-characters-in-javascript
function randomChunk(size) {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < size; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function RandomPushStream(toPush) {
  this.pushed  = 0;
  this.toPush  = toPush;
  this.started = false;
  this.paused  = false;
  this.closed  = false;
  this._handle = null;
}

RandomPushStream.prototype.readStart = function readStart() {
  if (this.closed) return;

  var stream = this;

  function writeChunk() {
    if (stream.paused) return;

    stream.pushed++;

    if (stream.toPush > 0 && stream.pushed > stream.toPush) {
      if (stream._handle) {
        clearInterval(stream._handle);
        stream._handle = undefined;
      }
      stream.closed = true;
      stream.onend();
    }
    else {
      stream.ondata(randomChunk(128));
    }
  }

  if (!this.started) {
    this._handle = setInterval(writeChunk, 23);
    this.started = true;
  }

  if (this.paused) {
    this._handle = setInterval(writeChunk, 23);
    this.paused = false;
  }
};

RandomPushStream.prototype.readStop = function readStop() {
  if (this.paused) return;

  if (this.started) {
    this.paused = true;
    clearInterval(this._handle);
    this._handle = undefined;
  }
  else {
    throw new Error('can\'t pause reading an unstarted stream');
  }
};

RandomPushStream.prototype.onend   = function onend() { };
RandomPushStream.prototype.ondata  = function ondata() {};
RandomPushStream.prototype.onerror = function onerror() {};

function readableStreamToArray(readable) {
  return new Promise(function (resolve, reject) {
    var chunks = [];

    readable.closed.then(function () { resolve(chunks); }, reject);

    function pump() {
      while (readable.state === 'readable') {
        var data = readable.read();
        chunks.push(data);
      }

      if (readable.state === 'waiting') {
        readable.wait().then(pump);
      }
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
      t.equal(typeof push, 'function', 'push is a function in start');
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
