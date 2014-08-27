var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import CountQueuingStrategy from '../lib/count-queuing-strategy';
import RandomPushSource from './utils/random-push-source';
import readableStreamToArray from './utils/readable-stream-to-array';
import sequentialReadableStream from './utils/sequential-rs';

test('ReadableStream can be constructed with no arguments', t => {
  t.plan(1);
  t.doesNotThrow(() => new ReadableStream(), 'ReadableStream constructed with no errors');
});

test('ReadableStream instances have the correct methods and properties', t => {
  t.plan(8);

  var rs = new ReadableStream();

  t.equal(typeof rs.read, 'function', 'has a read method');
  t.equal(typeof rs.wait, 'function', 'has a wait method');
  t.equal(typeof rs.cancel, 'function', 'has an cancel method');
  t.equal(typeof rs.pipeTo, 'function', 'has a pipeTo method');
  t.equal(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');

  t.equal(rs.state, 'waiting', 'state starts out waiting');

  t.ok(rs.closed, 'has a closed property');
  t.ok(rs.closed.then, 'closed property is thenable');
});

test(`ReadableStream closing puts the stream in a closed state, fulfilling the wait() and closed promises with
 undefined`, t => {
  t.plan(3);

  var rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.equal(rs.state, 'closed', 'The stream should be in closed state');

  rs.wait().then(
    v => t.equal(v, undefined, 'wait() should return a promise resolved with undefined'),
    () => t.fail('wait() should not return a rejected promise')
  );

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should return a promise resolved with undefined'),
    () => t.fail('closed should not return a rejected promise')
  );
});

test('ReadableStream reading a closed stream throws a TypeError', t => {
  t.plan(1);

  var rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.throws(() => rs.read(), /TypeError/);
});

test(`ReadableStream reading a stream makes wait() and closed return a promise resolved with undefined when the stream
 is fully drained`, t => {
  t.plan(6);

  var rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('test');
      close();
    }
  });

  t.equal(rs.state, 'readable', 'The stream should be in readable state');
  t.equal(rs.read(), 'test', 'A test string should be read');
  t.equal(rs.state, 'closed', 'The stream should be in closed state');

  t.throws(() => rs.read(), /TypeError/);

  rs.wait().then(
    v => t.equal(v, undefined, 'wait() should return a promise resolved with undefined'),
    () => t.fail('wait() should not return a rejected promise')
  );

  rs.closed.then(
    v => t.equal(v, undefined, 'closed should return a promise resolved with undefined'),
    () => t.fail('closed should not return a rejected promise')
  );
});

test('ReadableStream avoid redundant pull call', t => {
  var pullCount = 0;
  var rs = new ReadableStream({
    pull() {
      pullCount++;
    },

    cancel() {
      t.fail('cancel should not be called');
    }
  });

  rs.wait();
  rs.wait();
  rs.wait();

  // Use setTimeout to ensure we run after any promises.
  setTimeout(() => {
    t.equal(pullCount, 1, 'pull should not be called more than once');
    t.end();
  }, 50);
});

test('ReadableStream start throws an error', t => {
  t.plan(1);

  var error = new Error('aaaugh!!');

  try {
    new ReadableStream({ start() { throw error; } });
    t.fail('Constructor didn\'t throw');
  } catch (caughtError) {
    t.strictEqual(caughtError, error, 'error was allowed to propagate');
  }
});

test('ReadableStream pull throws an error', t => {
  t.plan(4);

  var error = new Error('aaaugh!!');
  var rs = new ReadableStream({ pull() { throw error; } });

  rs.wait().then(() => {
    t.fail('waiting should fail');
    t.end();
  });

  rs.closed.then(() => {
    t.fail('the stream should not close successfully');
    t.end();
  });

  rs.wait().catch(caught => {
    t.equal(rs.state, 'errored', 'state is "errored" after waiting');
    t.equal(caught, error, 'error was passed through as rejection of wait() call');
  });

  rs.closed.catch(caught => {
    t.equal(rs.state, 'errored', 'state is "errored" in closed catch');
    t.equal(caught, error, 'error was passed through as rejection reason of closed property');
  });
});

test('ReadableStream adapting a push source', t => {
  var pullChecked = false;
  var randomSource = new RandomPushSource(8);

  var rs = new ReadableStream({
    start(enqueue, close, error) {
      t.equal(typeof enqueue,  'function', 'enqueue is a function in start');
      t.equal(typeof close, 'function', 'close is a function in start');
      t.equal(typeof error, 'function', 'error is a function in start');

      randomSource.ondata = chunk => {
        if (!enqueue(chunk)) {
          randomSource.readStop();
        }
      };

      randomSource.onend = close;
      randomSource.onerror = error;
    },

    pull(enqueue, close, error) {
      if (!pullChecked) {
        pullChecked = true;
        t.equal(typeof enqueue, 'function', 'enqueue is a function in pull');
        t.equal(typeof close, 'function', 'close is a function in pull');
        t.equal(typeof error, 'function', 'error is a function in pull');
      }

      randomSource.readStart();
    }
  });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'should be closed');
    t.equal(chunks.length, 8, 'got the expected 8 chunks');
    for (var i = 0; i < chunks.length; i++) {
      t.equal(chunks[i].length, 128, 'each chunk has 128 bytes');
    }

    t.end();
  });
});

test('ReadableStream adapting a sync pull source', t => {
  var rs = sequentialReadableStream(10);

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed');
    t.equal(rs.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream adapting an async pull source', t => {
  var rs = sequentialReadableStream(10, { async: true });

  readableStreamToArray(rs).then(chunks => {
    t.equal(rs.state, 'closed', 'stream should be closed');
    t.equal(rs.source.closed, true, 'source should be closed');
    t.deepEqual(chunks, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'got the expected 10 chunks');

    t.end();
  });
});

test('ReadableStream is able to pull data repeatedly if it\'s available synchronously', t => {
  var i = 0;
  var rs = new ReadableStream({
    pull(enqueue, close) {
      if (++i <= 10) {
        enqueue(i);
      } else {
        close();
      }
    }
  });

  rs.wait().then(() => {
    var data = [];
    while (rs.state === 'readable') {
      data.push(rs.read());
    }

    t.deepEqual(data, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    t.end();
  });
});

test('ReadableStream wait() does not error when no more data is available', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(1);

  var rs = sequentialReadableStream(5, { async: true });
  var result = [];

  pump();

  function pump() {
    while (rs.state === 'readable') {
      result.push(rs.read());
    }

    if (rs.state === 'closed') {
      t.deepEqual(result, [1, 2, 3, 4, 5], 'got the expected 5 chunks');
    } else {
      rs.wait().then(pump, r => t.ifError(r));
    }
  }
});

test('ReadableStream should be able to get data sequentially from an asynchronous stream', t => {
  // https://github.com/whatwg/streams/issues/80

  t.plan(4);

  var rs = sequentialReadableStream(3, { async: true });

  var result = [];
  var EOF = Object.create(null);

  getNext().then(v => {
    t.equal(v, 1, 'first chunk should be 1');
    return getNext().then(v => {
      t.equal(v, 2, 'second chunk should be 2');
      return getNext().then(v => {
        t.equal(v, 3, 'third chunk should be 3');
        return getNext().then(v => {
          t.equal(v, EOF, 'fourth result should be EOF');
        });
      });
    });
  })
  .catch(r => t.ifError(r));

  function getNext() {
    if (rs.state === 'closed') {
      return Promise.resolve(EOF);
    }

    return rs.wait().then(() => {
      if (rs.state === 'readable') {
        return rs.read();
      } else if (rs.state === 'closed') {
        return EOF;
      }
    });
  }
});

test('Default ReadableStream returns `false` for any `enqueue` call', t => {
  t.plan(5);

  new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('hi'), false);
      t.equal(enqueue('hey'), false);
      t.equal(enqueue('whee'), false);
      t.equal(enqueue('yo'), false);
      t.equal(enqueue('sup'), false);
    }
  });
});

test('ReadableStream returns `true` unless we are at or above the highWaterMark', t => {
  t.plan(5);

  new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('a'), true);
      t.equal(enqueue('b'), false);
      t.equal(enqueue('c'), false);
      t.equal(enqueue('d'), false);
      t.equal(enqueue('e'), false);
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 2 })
  });
});

test('ReadableStream continues returning `true` from `enqueue` if the data is read out of it in time', t => {
  t.plan(12);

  var rs = new ReadableStream({
    start(enqueue) {
      // Delay a bit so that the stream is successfully constructed and thus the `rs` variable references something.
      setTimeout(() => {
        t.equal(enqueue('foo'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'foo');
        t.equal(rs.state, 'waiting');

        t.equal(enqueue('bar'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'bar');
        t.equal(rs.state, 'waiting');

        t.equal(enqueue('baz'), true);
        t.equal(rs.state, 'readable');
        t.equal(rs.read(), 'baz');
        t.equal(rs.state, 'waiting');
      }, 0);
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 4 })
  });
});

test('ReadableStream enqueue fails when the stream is in closing state', t => {
  var rs = new ReadableStream({
    start(enqueue, close) {
      t.equal(enqueue('a'), true);
      close();

      t.throws(
        () => t.equal(enqueue('b'), false),
        /TypeError/,
        'enqueue after close must throw a TypeError'
      );
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 10 })
  });

  t.equal(rs.state, 'readable');
  t.equal(rs.read(), 'a');
  t.equal(rs.state, 'closed');
  t.end();
});

test('ReadableStream if needsMore throws, the stream is errored', t => {
  var error = new Error('aaaugh!!');

  var rs = new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('hi'), false);
    },
    strategy: {
      size() {
        return 1;
      },

      needsMore() {
        throw error;
      }
    }
  });

  rs.closed.catch(r => {
    t.strictEqual(r, error);
    t.end();
  });
});

test('ReadableStream if size throws, the stream is errored', t => {
  var error = new Error('aaaugh!!');

  var rs = new ReadableStream({
    start(enqueue) {
      t.equal(enqueue('hi'), false);
    },
    strategy: {
      size() {
        throw error;
      },

      needsMore() {
        return true;
      }
    }
  });

  rs.closed.catch(r => {
    t.strictEqual(r, error);
    t.end();
  });
});
