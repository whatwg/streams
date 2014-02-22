'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;
var RandomPushSource = require('./lib/random-push-source.js');

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

test('BaseReadableStream is globally defined', function (t) {
  /*global BaseReadableStream*/
  t.plan(1);

  var basic;
  t.doesNotThrow(function () { basic = new BaseReadableStream(); },
                 'BaseReadableStream is available');
});

test('BaseReadableStream is constructed correctly', function (t) {
  /*global BaseReadableStream*/
  t.plan(8);

  var basic = new BaseReadableStream();

  t.equal(typeof basic.read, 'function', 'stream has a read function');
  t.equal(typeof basic.wait, 'function', 'stream has a wait function');
  t.equal(typeof basic.abort, 'function', 'stream has an abort function');
  t.equal(typeof basic.pipeTo, 'function', 'stream has a pipeTo function');
  t.equal(typeof basic.pipeThrough, 'function', 'stream has a pipeThrough function');

  t.equal(basic.state, 'waiting', 'stream starts out waiting');

  t.ok(basic.closed, 'stream has closed promise');
  t.ok(basic.closed.then, 'stream has closed promise that is thenable');
});

test('BaseReadableStream avoid redundant pull call', function (t) {
  /*global BaseReadableStream*/
  var pullCount = 0;
  var readable = new BaseReadableStream({
    start : function start() {
    },

    pull : function pull() {
      pullCount++;
    },

    abort : function abort() {
      t.fail("abort should not be called");
    }
  });

  readable.wait();
  readable.wait();
  readable.wait();

  // es6-promise uses setTimeout with delay of 1 to run handlers async. We need
  // to use longer delay.
  setTimeout(function () {
    t.equal(pullCount, 1, 'pull should not be called more than once');
    t.end();
  }, 150);
});

test('BaseReadableStream adapting a push stream', function (t) {
  /*global BaseReadableStream*/
  var pullChecked = false;
  var randomSource = new RandomPushSource(8);

  var basic = new BaseReadableStream({
    start : function start(push, close, error) {
      t.equal(typeof push,  'function', 'push is a function in start');
      t.equal(typeof close, 'function', 'close is a function in start');
      t.equal(typeof error, 'function', 'error is a function in start');

      randomSource.ondata = function (chunk) {
        if (!push(chunk)) randomSource.readStop();
      };

      randomSource.onend = close;
      randomSource.onerror = error;
    },

    pull : function pull(push, close, error) {
      if (!pullChecked) {
        pullChecked = true;
        t.equal(typeof push, 'function', 'push is a function in pull');
        t.equal(typeof close, 'function', 'close is a function in pull');
        t.equal(typeof error, 'function', 'error is a function in pull');
      }

      randomSource.readStart();
    }
  });

  readableStreamToArray(basic).then(function (chunks) {
    t.equal(basic.state, 'closed', 'should be closed');
    t.equal(chunks.length, 8, 'got the expected 8 chunks');
    for (var i = 0; i < chunks.length; i++) {
      t.equal(chunks[i].length, 128, 'each chunk has 128 bytes');
    }

    t.end();
  });
});

test('BaseReadableStream aborting an infinite stream', function (t) {
  /*global BaseReadableStream, BaseWritableStream*/
  var randomSource = new RandomPushSource();

  var readable = new BaseReadableStream({
    start : function start(push, close, error) {
      randomSource.ondata  = push;
      randomSource.onend   = close;
      randomSource.onerror = error;
    },

    pull : function pull() { randomSource.readStart(); },

    abort : function abort() {
      randomSource.readStop();
      randomSource.onend();
    }
  });

  var storage = [];
  var writable = new BaseWritableStream({
    write : function write(data, done) {
      storage.push(data);
      done();
    }
  });

  readable.pipeTo(writable);

  readable.closed.then(function () {
    t.equal(readable.state, 'closed', 'readable should be closed');
  });

  writable.closed.then(function () {
    t.equal(writable.state, 'closed', 'writable should be closed');
    t.ok(storage.length > 0, 'should have gotten some data written through the pipe');
    for (var i = 0; i < storage.length; i++) {
      t.equal(storage[i].length, 128, 'each chunk has 128 bytes');
    }

    t.end();
  });

  setTimeout(function () {
    readable.abort(new Error('don\'t feel like dealing with randomness anymore'));
  }, 150);
});
