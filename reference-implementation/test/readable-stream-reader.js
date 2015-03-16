const test = require('tape-catch');

let ReadableStreamReader;

test('Can get the ReadableStreamReader constructor indirectly', t => {
  t.doesNotThrow(() => {
    // It's not exposed globally, but we test a few of its properties here.
    ReadableStreamReader = (new ReadableStream()).getReader().constructor;
  });
  t.end();
});

test('Constructing an ReadableStreamReader directly should fail if the stream is already locked (via direct ' +
     'construction)', t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly the first time should be fine');
  t.throws(() => new ReadableStreamReader(rs), /TypeError/, 'constructing directly the second time should fail');
  t.end();
});

test('Getting an ReadableStreamReader via getReader should fail if the stream is already locked (via direct ' +
     'construction', t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should be fine');
  t.throws(() => rs.getReader(), /TypeError/, 'getReader() should fail');
  t.end();
});

test('Constructing an ReadableStreamReader directly should fail if the stream is already locked (via getReader)',
     t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => rs.getReader(), 'getReader() should be fine');
  t.throws(() => new ReadableStreamReader(rs), /TypeError/, 'constructing directly should fail');
  t.end();
});

test('Constructing an ReadableStreamReader directly should be OK if the stream is closed',
     t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should not throw');
  t.end();
});

test('Constructing an ReadableStreamReader directly should be OK if the stream is errored',
     t => {
  const theError = new Error('don\'t say i didn\'t warn ya');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
    }
  });

  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should not throw');
  t.end();
});

test('Reading from a reader for an empty stream will wait until a chunk is available', t => {
  let enqueue;
  const rs = new ReadableStream({
    start(e) {
      enqueue = e;
    }
  });
  const reader = rs.getReader();

  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false }, 'read() should fulfill with the enqueued chunk');
    t.end();
  });

  enqueue('a');
});

test('cancel() on a reader releases the reader before calling through', t => {
  t.plan(3);

  const passedReason = new Error('it wasn\'t the right time, sorry');
  const rs = new ReadableStream({
    cancel(reason) {
      t.doesNotThrow(() => rs.getReader(), 'should be able to get another reader without error');
      t.equal(reason, passedReason, 'the cancellation reason is passed through to the underlying source');
    }
  });

  const reader = rs.getReader();
  reader.cancel(passedReason).then(
    () => t.pass('reader.cancel() should fulfill'),
    e => t.fail('reader.cancel() should not reject')
  );
});

test('closed should be fulfilled after stream is closed (.closed access before acquiring)', t => {
  t.plan(1);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  const reader = rs.getReader();
  reader.closed.then(() => {
    t.pass('reader closed should be fulfilled');
  });

  doClose();
});

test('closed should be fulfilled after reader releases its lock (multiple stream locks)', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  const reader1 = rs.getReader();

  reader1.releaseLock();

  const reader2 = rs.getReader();
  doClose();

  reader1.closed.then(() => {
    t.pass('reader1 closed should be fulfilled');
  });

  reader2.closed.then(() => {
    t.pass('reader2 closed should be fulfilled');
  });
});

test('Multiple readers can access the stream in sequence', t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      enqueue('a');
      enqueue('b');
      close();
    }
  });

  const reader1 = rs.getReader();
  reader1.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'reading the first chunk from reader1 works'));
  reader1.releaseLock();

  const reader2 = rs.getReader();
  reader2.read().then(r => t.deepEqual(r, { value: 'b', done: false }, 'reading the second chunk from reader2 works'));
  reader2.releaseLock();

  t.end();
});

test('Cannot use an already-released reader to unlock a stream again', t => {
  t.plan(1);

  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
    }
  });

  const reader1 = rs.getReader();
  reader1.releaseLock();

  const reader2 = rs.getReader();

  reader1.releaseLock();
  reader2.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      'read() should still work on reader2 even after reader1 is released');
  });
});

test('cancel() on a released reader is a no-op and does not pass through', t => {
  const rs = new ReadableStream({
    start(enqueue) {
      enqueue('a');
    },
    cancel() {
      t.fail('underlying source cancel should not be called');
    }
  });

  const reader = rs.getReader();
  reader.releaseLock();
  reader.cancel().then(v => t.equal(v, undefined, 'cancel() on the reader should fulfill with undefined'));

  const reader2 = rs.getReader();
  reader2.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'a new reader should be able to read a chunk'));

  setTimeout(() => t.end(), 50);
});
