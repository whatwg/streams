'use strict';
const test = require('tape-catch');

// Many other pipeTo-with-options tests have been templated.

test('Piping with no options and a destination error', t => {
  t.plan(4);

  class DelayedEnqueuingSource {
    constructor() {
      this._canceled = false;
    }

    start(c) {
      c.enqueue('a');
      setTimeout(() => {
        t.notOk(this._canceled, 'the stream should not have been canceled yet');
        c.enqueue('b');
      }, 10);
      setTimeout(() => {
        t.ok(this._canceled, 'the stream should have been canceled');
        t.throws(() => c.enqueue('c'), 'enqueue after cancel should throw');
      }, 20);
    }

    cancel(r) {
      t.equal(r, theError, 'reason passed to cancel equals the source error');

      this._canceled = true;
    }
  }

  const theError = new Error('destination error');
  const rs = new ReadableStream(new DelayedEnqueuingSource());

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws);
});

test('Piping with { preventCancel: false } and a destination error', t => {
  t.plan(4);

  class DelayedEnqueuingSource {
    constructor() {
      this._canceled = false;
    }

    start(c) {
      c.enqueue('a');
      setTimeout(() => {
        t.notOk(this._canceled, 'the stream should not have been canceled yet');
        c.enqueue('b');
      }, 10);
      setTimeout(() => {
        t.ok(this._canceled, 'the stream should have been canceled');
        t.throws(() => c.enqueue('c'), 'enqueue after cancel should throw');
      }, 20);
    }

    cancel(r) {
      t.equal(r, theError, 'reason passed to cancel equals the source error');

      this._canceled = true;
    }
  }

  const theError = new Error('destination error');
  const rs = new ReadableStream(new DelayedEnqueuingSource());

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws, { preventCancel: false });
});

test('Piping with { preventCancel: true } and a destination error', t => {
  let resolveLastEnqueuePromise;
  const lastEnqueuePromise = new Promise((r) => {
    resolveLastEnqueuePromise = r;
  });

  const theError = new Error('destination error');
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      setTimeout(() => c.enqueue('b'), 10);
      setTimeout(() => c.enqueue('c'), 20);
      setTimeout(() => {
        c.enqueue('d');
        resolveLastEnqueuePromise();
      }, 30);
    },
    cancel() {
      t.fail('unexpected call to cancel');
    }
  });

  const ws = new WritableStream({
    write(chunk) {
      if (chunk === 'b') {
        throw theError;
      }
    }
  });

  rs.pipeTo(ws, { preventCancel: true }).catch(e => {
    t.equal(e, theError, 'rejection reason of pipeTo promise is the sink error');

    let reader;
    t.doesNotThrow(() => { reader = rs.getReader(); }, 'should be able to get a stream reader after pipeTo completes');

    // { value: 'c', done: false } gets consumed before we know that ws has errored, and so is lost.

    return reader.read().then(result => {
      t.deepEqual(result, { value: 'd', done: false }, 'should be able to read the remaining chunk from the reader');
      return lastEnqueuePromise;
    }).then(() => {
      t.end();
    });
  })
  .catch(e => t.error(e));
});
