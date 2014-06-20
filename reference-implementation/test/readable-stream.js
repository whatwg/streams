var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import RandomPushSource from './lib/random-push-source';
import readableStreamToArray from './lib/readable-stream-to-array';
import sequentialReadableStream from './lib/sequential-rs';

test('ReadableStream is globally defined', function (t) {
  t.plan(1);

  var basic;
  t.doesNotThrow(function () { basic = new ReadableStream(); },
                 'ReadableStream is available');
});

test('ReadableStream is constructed correctly', function (t) {
  t.plan(8);

  var basic = new ReadableStream();

  t.equal(typeof basic.read, 'function', 'stream has a read function');
  t.equal(typeof basic.wait, 'function', 'stream has a wait function');
  t.equal(typeof basic.cancel, 'function', 'stream has an cancel function');
  t.equal(typeof basic.pipeTo, 'function', 'stream has a pipeTo function');
  t.equal(typeof basic.pipeThrough, 'function', 'stream has a pipeThrough function');

  t.equal(basic.state, 'waiting', 'stream starts out waiting');

  t.ok(basic.closed, 'stream has closed promise');
  t.ok(basic.closed.then, 'stream has closed promise that is thenable');
});

test('ReadableStream closing puts the stream in a closed state and makes wait and closed return a promise resolved with undefined', function (t) {
  t.plan(3);

  var readable = new ReadableStream({
    start : function (push, close, error) {
      close();
    }
  });

  t.equal(readable.state, 'closed', 'The stream should be in closed state');

  readable.wait().then(function (v) {
    t.equal(v, undefined, 'wait should return a promise resolved with undefined');
  }, function (err) {
    t.fail('wait should not return a rejected promise');
  });

  readable.closed.then(function (v) {
    t.equal(v, undefined, 'closed should return a promise resolved with undefined');
  }, function (err) {
    t.fail('closed should not return a rejected promise');
  });
});

test('ReadableStream reading a closed stream throws a TypeError', function (t) {
  t.plan(1);

  var readable = new ReadableStream({
    start : function (push, close, error) {
      close();
    }
  });

  t.throws(
    function () {
      readable.read();
    },
    function (caught) {
      t.equal(caught.name, 'TypeError', 'A TypeError is thrown');
    }
  );
});

test('ReadableStream reading a stream makes wait and closed return a promise resolved with undefined when the stream is fully drained', function (t) {
  t.plan(6);

  var readable = new ReadableStream({
    start : function (push, close, error) {
      push("test");
      close();
    }
  });

  t.equal(readable.state, 'readable', 'The stream should be in readable state');
  t.equal(readable.read(), 'test', 'A test string should be read');
  t.equal(readable.state, 'closed', 'The stream should be in closed state');

  t.throws(
    function () {
      readable.read();
    },
    function (caught) {
      t.equal(caught.name, 'TypeError', 'A TypeError should be thrown');
    }
  );

  readable.wait().then(function (v) {
    t.equal(v, undefined, 'wait should return a promise resolved with undefined');
  }, function (err) {
    t.fail('wait should not return a rejected promise');
  });

  readable.closed.then(function (v) {
    t.equal(v, undefined, 'closed should return a promise resolved with undefined');
  }, function (err) {
    t.fail('closed should not return a rejected promise');
  });
});

test('ReadableStream avoid redundant pull call', function (t) {
  var pullCount = 0;
  var readable = new ReadableStream({
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

test('ReadableStream start throws an error', function (t) {
  t.plan(1);

  var error = new Error("aaaugh!!");

  t.throws(
    function () {
      new ReadableStream({
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

test('ReadableStream pull throws an error', function (t) {

  t.plan(4);

  var error = new Error("aaaugh!!");
  var readable = new ReadableStream({
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

test('ReadableStream adapting a push source', function (t) {
  var pullChecked = false;
  var randomSource = new RandomPushSource(8);

  var basic = new ReadableStream({
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

test('ReadableStream adapting a sync pull source', function (t) {
  var stream = sequentialReadableStream(10);

  readableStreamToArray(stream).then(function (chunks) {
    t.equal(stream.state, 'closed', 'stream should be closed');
    t.equal(stream.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream adapting an async pull source', function (t) {
  var stream = sequentialReadableStream(10, { async: true });

  readableStreamToArray(stream).then(function (chunks) {
    t.equal(stream.state, 'closed', 'stream should be closed');
    t.equal(stream.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream canceling an infinite stream', function (t) {
  /*global ReadableStream */
  var randomSource = new RandomPushSource();

  var cancelationFinished = false;
  var readable = new ReadableStream({
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

test('ReadableStream is able to pull data repeatedly if it\'s available synchronously', function (t) {

  var i = 0;
  var readable = new ReadableStream({
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

test('ReadableStream wait does not error when no more data is available', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var stream = sequentialReadableStream(5, { async: true });

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

test('ReadableStream should be able to get data sequentially from an asynchronous stream', function (t) {
  // https://github.com/whatwg/streams/issues/80

  t.plan(4);

  var stream = sequentialReadableStream(3, { async: true });

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

test('ReadableStream cancellation puts the stream in a closed state (no data pulled yet)', function (t) {
  var stream = sequentialReadableStream(5);

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

test('ReadableStream cancellation puts the stream in a closed state (after waiting for data)', function (t) {
  var stream = sequentialReadableStream(5);

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

test('ReadableStream returns `true` for the first `push` call; `false` thereafter, if nobody reads', function (t) {
  t.plan(5);

  var pushes = 0;
  var stream = new ReadableStream({
    start : function (push) {
      t.equal(push('hi'), true);
      t.equal(push('hey'), false);
      t.equal(push('whee'), false);
      t.equal(push('yo'), false);
      t.equal(push('sup'), false);
    }
  });
});

test('ReadableStream continues returning `true` from `push` if the data is read out of it', function (t) {
  t.plan(12);

  var stream = new ReadableStream({
    start : function (push) {
      // Delay a bit so that the stream is successfully constructed and thus the `stream` variable references something.
      setTimeout(function () {
        t.equal(push('hi'), true);
        t.equal(stream.state, 'readable');
        t.equal(stream.read(), 'hi');
        t.equal(stream.state, 'waiting');

        t.equal(push('hey'), true);
        t.equal(stream.state, 'readable');
        t.equal(stream.read(), 'hey');
        t.equal(stream.state, 'waiting');

        t.equal(push('whee'), true);
        t.equal(stream.state, 'readable');
        t.equal(stream.read(), 'whee');
        t.equal(stream.state, 'waiting');
      }, 0);
    }
  });
});
