var test = require('tape');

import ReadableStream from '../lib/readable-stream';

test('Throwing underlying source start getter', t => {
  var theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      get start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying source start method', t => {
  var theError = new Error('a unique string');

  t.throws(() => {
    new ReadableStream({
      start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Throwing underlying source pull getter (initial pull)', t => {
  t.plan(1);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    get pull() {
      throw theError;
    }
  });

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source pull method (initial pull)', t => {
  t.plan(1);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    pull() {
      throw theError;
    }
  });

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source pull getter (second pull)', t => {
  t.plan(3);

  var theError = new Error('a unique string');
  var counter = 0;
  var rs = new ReadableStream({
    get pull() {
      ++counter;
      if (counter === 1) {
        return enqueue => enqueue('a');
      }

      throw theError;
    }
  });

  rs.ready.then(() => {
    t.equal(rs.state, 'readable', 'sanity check: the stream becomes readable without issue');

    t.throws(() => rs.read(), /a unique string/, 'reading triggers a pull, and the error is re-thrown');
  });

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source pull method (second pull)', t => {
  t.plan(3);

  var theError = new Error('a unique string');
  var counter = 0;
  var rs = new ReadableStream({
    pull(enqueue) {
      ++counter;
      if (counter === 1) {
        enqueue('a');
      } else {
        throw theError;
      }
    }
  });

  rs.ready.then(() => {
    t.equal(rs.state, 'readable', 'sanity check: the stream becomes readable without issue');

    t.throws(() => rs.read(), /a unique string/, 'reading triggers a pull, and the error is re-thrown');
  });

  rs.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Throwing underlying source cancel getter', t => {
  t.plan(1);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    get cancel() {
      throw theError;
    }
  });

  rs.cancel().then(
    () => t.fail('cancel should not fulfill'),
    r => t.equal(r, theError, 'cancel should reject with the thrown error')
  );
});

test('Throwing underlying source cancel method', t => {
  t.plan(1);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    cancel() {
      throw theError;
    }
  });

  rs.cancel().then(
    () => t.fail('cancel should not fulfill'),
    r => t.equal(r, theError, 'cancel should reject with the thrown error')
  );
});

test('Throwing underlying source strategy getter', t => {
  t.plan(2);

  var theError = new Error('a unique string');

  var rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/);
    },
    get strategy() {
      throw theError;
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('Throwing underlying source strategy.size getter', t => {
  t.plan(2);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/);
    },
    strategy: {
      get size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('Throwing underlying source strategy.size method', t => {
  t.plan(2);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/);
    },
    strategy: {
      size() {
        throw theError;
      },
      shouldApplyBackpressure() {
        return true;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('Throwing underlying source strategy.shouldApplyBackpressure getter', t => {
  t.plan(2);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/);
    },
    strategy: {
      size() {
        return 1;
      },
      get shouldApplyBackpressure() {
        throw theError;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});

test('Throwing underlying source strategy.shouldApplyBackpressure method', t => {
  t.plan(2);

  var theError = new Error('a unique string');
  var rs = new ReadableStream({
    start(enqueue) {
      t.throws(() => enqueue('a'), /a unique string/);
    },
    strategy: {
      size() {
        return 1;
      },
      shouldApplyBackpressure() {
        throw theError;
      }
    }
  });

  t.equal(rs.state, 'errored', 'state should be errored');
});
