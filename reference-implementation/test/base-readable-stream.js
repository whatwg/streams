'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;
var RandomPushSource = require('./lib/random-push-source.js');
var SequentialPullSource = require('./lib/sequential-pull-source.js');

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
  t.equal(typeof basic.cancel, 'function', 'stream has an cancel function');
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
    pull : function pull() {
      pullCount++;
    },

    cancel : function cancel() {
      t.fail('cancel should not be called');
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

test('BaseReadableStream start throws an error', function (t) {
  /*global BaseReadableStream*/
  t.plan(1);

  var error = new Error("aaaugh!!");

  t.throws(
    function () {
      new BaseReadableStream({
        start : function () {
          throw error;
        }
      })
    },
    function (caught) {
      t.equal(caught, error, 'error was allowed to propagate');
    }
  );
});

test('BaseReadableStream pull throws an error', function (t) {
  /*global BaseReadableStream*/

  t.plan(4);

  var error = new Error("aaaugh!!");
  var readable = new BaseReadableStream({
    pull : function () {
      throw error;
    }
  });

  readable.wait().then(function () {
    t.fail('waiting should fail');
    t.end();
  });

  readable.closed.then(function () {
    t.fail('the stream should not close successfully');
    t.end();
  });

  readable.wait().catch(function (caught) {
    t.equal(readable.state, 'errored', 'state is "errored" after waiting');
    t.equal(caught, error, 'error was passed through as rejection of wait() call');
  });

  readable.closed.catch(function (caught) {
    t.equal(readable.state, 'errored', 'state is "errored" in close catch');
    t.equal(caught, error, 'error was passed through as rejection of closed property');
  });
});

test('BaseReadableStream adapting a push source', function (t) {
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

test('BaseReadableStream adapting a pull source', function (t) {
  /*global BaseReadableStream*/
  var sequentialSource = new SequentialPullSource(10);

  var basic = new BaseReadableStream({
    start : function () {
      return new Promise(function (resolve, reject) {
        sequentialSource.open(function (err) {
          if (err) reject(err);
          resolve();
        });
      });
    },

    pull : function (push, finish, error) {
      sequentialSource.read(function (err, done, data) {
        if (err) {
          error(err);
        } else if (done) {
          sequentialSource.close(function (err) {
            if (err) error(err);
            finish();
          });
        } else {
          push(data);
        }
      });
    }
  });

  readableStreamToArray(basic).then(function (chunks) {
    t.equal(basic.state, 'closed', 'stream should be closed');
    t.equal(sequentialSource.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('BaseReadableStream canceling an infinite stream', function (t) {
  /*global BaseReadableStream */
  var randomSource = new RandomPushSource();

  var cancelationFinished = false;
  var readable = new BaseReadableStream({
    start : function start(push, close, error) {
      randomSource.ondata  = push;
      randomSource.onend   = close;
      randomSource.onerror = error;
    },

    pull : function pull() { randomSource.readStart(); },

    cancel : function cancel() {
      randomSource.readStop();
      randomSource.onend();

      return new Promise(function (resolve) {
        setTimeout(function () {
          cancelationFinished = true;
          resolve();
        }, 50);
      });
    }
  });

  readableStreamToArray(readable).then(
    function (storage) {
      t.equal(readable.state, 'closed', 'readable should be closed');
      t.equal(cancelationFinished, false, 'it did not wait for the cancellation process to finish before closing');
      t.ok(storage.length > 0, 'should have gotten some data written through the pipe');
      for (var i = 0; i < storage.length; i++) {
        t.equal(storage[i].length, 128, 'each chunk has 128 bytes');
      }
    },
    function (err) {
      t.ifError(err);
      t.end();
    }
  )

  setTimeout(function () {
    readable.cancel(new Error('don\'t feel like dealing with randomness anymore')).then(function () {
      t.equal(cancelationFinished, true, 'it returns a promise that waits for the cancellation to finish');
      t.end();
    });
  }, 150);
});

test('BaseReadableStream is able to pull data repeatedly if it\'s available synchronously', function (t) {
  /*global BaseReadableStream*/

  var i = 0;
  var readable = new BaseReadableStream({
    pull : function pull(push, close) {
      if (++i <= 10) {
        push(i);
      } else {
        close();
      }
    }
  });

  readable.wait().then(function () {
    var data = [];
    while (readable.state === 'readable') {
      data.push(readable.read());
    }

    t.deepEqual(data, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    t.end();
  });
});
