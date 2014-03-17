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

function sequentialBaseReadableStream(limit, options) {
  var sequentialSource = new SequentialPullSource(limit, options);

  var stream = new BaseReadableStream({
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

  stream.source = sequentialSource;

  return stream;
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

test('BaseReadableStream adapting a sync pull source', function (t) {
  /*global BaseReadableStream*/
  var stream = sequentialBaseReadableStream(10);

  readableStreamToArray(stream).then(function (chunks) {
    t.equal(stream.state, 'closed', 'stream should be closed');
    t.equal(stream.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('BaseReadableStream adapting an async pull source', function (t) {
  /*global BaseReadableStream*/
  var stream = sequentialBaseReadableStream(10, { async: true });

  readableStreamToArray(stream).then(function (chunks) {
    t.equal(stream.state, 'closed', 'stream should be closed');
    t.equal(stream.source.closed, true, 'source should be closed');
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
    readable.cancel().then(function () {
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

test('BaseReadableStream wait does not error when no more data is available', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var stream = sequentialBaseReadableStream(5, { async: true });

  var result = [];
  function pump() {
    while (stream.state === 'readable') {
      result.push(stream.read());
    }

    if (stream.state === 'closed') {
      t.deepEqual(result, [1, 2, 3, 4, 5], 'got the expected 5 chunks');
    } else {
      stream.wait().then(pump, function (err) {
        t.ifError(err);
      });
    }
  }

  pump();
});

test('BaseReadableStream should be able to get data sequentially from an asynchronous stream', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(4);

  var stream = sequentialBaseReadableStream(3, { async: true });

  var result = [];
  var EOF = Object.create(null);

  function getNext() {
    if (stream.state === 'closed') {
      return Promise.resolve(EOF);
    }

    return stream.wait().then(function () {
      if (stream.state === 'readable') {
        return stream.read();
      } else if (stream.state === 'closed') {
        return EOF;
      }
    });
  }

  getNext().then(function (v) {
    t.equal(v, 1, 'first chunk should be 1');
    return getNext().then(function (v) {
      t.equal(v, 2, 'second chunk should be 2');
      return getNext().then(function (v) {
        t.equal(v, 3, 'third chunk should be 3');
        return getNext().then(function (v) {
          t.equal(v, EOF, 'fourth result should be EOF');
        });
      });
    });
  })
  .catch(t.ifError.bind(t));
});

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

test('BaseReadableStream cancellation puts the stream in a closed state (no data pulled yet)', function (t) {
  var stream = sequentialBaseReadableStream(5);

  t.plan(5);

  stream.closed.then(function () {
    t.assert(true, 'closed promise vended before the cancellation should fulfill');
  }, function (err) {
    t.fail('closed promise vended before the cancellation should not be rejected');
  });
  stream.wait().then(function () {
    t.assert(true, 'wait promise vended before the cancellation should fulfill');
  }, function (err) {
    t.fail('wait promise vended before the cancellation should not be rejected');
  });

  stream.cancel();

  t.equal(stream.state, 'closed', 'state should be closed');

  stream.closed.then(function () {
    t.assert(true, 'closed promise vended after the cancellation should fulfill');
  }, function (err) {
    t.fail('closed promise vended after the cancellation should not be rejected');
  });
  stream.wait().then(function () {
    t.assert(true, 'wait promise vended after the cancellation should fulfill');
  }, function (err) {
    t.fail('wait promise vended after the cancellation should not be rejected');
  });
});
test('BaseReadableStream cancellation puts the stream in a closed state (after waiting for data)', function (t) {
  var stream = sequentialBaseReadableStream(5);

  t.plan(5);

  stream.wait().then(function () {
    stream.closed.then(function () {
      t.assert(true, 'closed promise vended before the cancellation should fulfill');
    }, function (err) {
      t.fail('closed promise vended before the cancellation should not be rejected');
    });
    stream.wait().then(function () {
      t.assert(true, 'wait promise vended before the cancellation should fulfill');
    }, function (err) {
      t.fail('wait promise vended before the cancellation should not be rejected');
    });

    stream.cancel();

    t.equal(stream.state, 'closed', 'state should be closed');

    stream.closed.then(function () {
      t.assert(true, 'closed promise vended after the cancellation should fulfill');
    }, function (err) {
      t.fail('closed promise vended after the cancellation should not be rejected');
    });
    stream.wait().then(function () {
      t.assert(true, 'wait promise vended after the cancellation should fulfill');
    }, function (err) {
      t.fail('wait promise vended after the cancellation should not be rejected');
    });
  }, t.ifError.bind(t));
});
