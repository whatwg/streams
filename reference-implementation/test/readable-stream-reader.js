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

test('Constructing an ReadableStreamReader directly should fail if the stream is already closed',
     t => {
  const rs = new ReadableStream({
    start(enqueue, close) {
      close();
    }
  });

  t.throws(() => new ReadableStreamReader(rs), /TypeError/, 'constructing directly should fail');
  t.end();
});

test('Constructing an ReadableStreamReader directly should fail if the stream is already errored',
     t => {
  const theError = new Error('don\'t say i didn\'t warn ya');
  const rs = new ReadableStream({
    start(enqueue, close, error) {
      error(theError);
    }
  });

  t.throws(() => new ReadableStreamReader(rs), /don't say i didn't warn ya/, 'getReader() threw the error');
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

  t.equal(reader.isActive, true, 'reader is active to start with');

  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false }, 'read() should fulfill with the enqueued chunk');
    t.equal(reader.isActive, true, 'reader is still active');
    t.end();
  });

  enqueue('a');
});

test('cancel() on a reader releases the reader before calling through', t => {
  t.plan(3);

  const passedReason = new Error('it wasn\'t the right time, sorry');
  const rs = new ReadableStream({
    cancel(reason) {
      t.equal(reader.isActive, false, 'reader should be released by the time underlying source cancel is called');
      t.equal(reason, passedReason, 'the cancellation reason is passed through to the underlying source');
    }
  });

  const reader = rs.getReader();
  reader.cancel(passedReason).then(
    () => t.pass('reader.cancel() should fulfill'),
    e => t.fail('reader.cancel() should not reject')
  );
});

test('closed should be fulfilled after stream is closed (stream .closed access before acquiring)', t => {
  t.plan(2);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  rs.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when stream closed is fulfilled');
  });

  const reader = rs.getReader();
  doClose();

  reader.closed.then(() => {
    t.equal(reader.isActive, false, 'reader is no longer active when reader closed is fulfilled');
  });
});

test('closed should be fulfilled after reader releases its lock (multiple stream locks)', t => {
  t.plan(6);

  let doClose;
  const rs = new ReadableStream({
    start(enqueue, close) {
      doClose = close;
    }
  });

  const reader1 = rs.getReader();

  rs.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when stream closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when stream closed is fulfilled');
  });

  reader1.releaseLock();

  const reader2 = rs.getReader();
  doClose();

  reader1.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when reader1 closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when reader1 closed is fulfilled');
  });

  reader2.closed.then(() => {
    t.equal(reader1.isActive, false, 'reader1 is no longer active when reader2 closed is fulfilled');
    t.equal(reader2.isActive, false, 'reader2 is no longer active when reader2 closed is fulfilled');
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
  t.plan(2);

  const rs = new ReadableStream();

  const reader1 = rs.getReader();
  reader1.releaseLock();

  const reader2 = rs.getReader();
  t.equal(reader2.isActive, true, 'reader2 state is active before releasing reader1');

  reader1.releaseLock();
  t.equal(reader2.isActive, true, 'reader2 state is still active after releasing reader1 again');
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
