import gc from './utils/gc';
const test = require('tape-catch');

let ReadableStreamReader;

test('Can get the ReadableStreamReader constructor indirectly', t => {
  t.doesNotThrow(() => {
    // It's not exposed globally, but we test a few of its properties here.
    ReadableStreamReader = (new ReadableStream()).getReader().constructor;
  });
  t.end();
});

test('ReadableStreamReader constructor should get a ReadableStream object as argument', t => {
  t.throws(() => { new ReadableStreamReader('potato'); }, /TypeError/, 'constructor fails with a string');
  t.throws(() => { new ReadableStreamReader({ }); }, /TypeError/, 'constructor fails with a plain object');
  t.throws(() => { new ReadableStreamReader(); }, /TypeError/, 'constructor fails without parameters');
  t.end();
});

test('ReadableStreamReader instances should have the correct list of properties', t => {
  const methods = ['cancel', 'constructor', 'read', 'releaseLock'];
  const properties = methods.concat(['closed']).sort();

  const rsReader = new ReadableStreamReader(new ReadableStream());
  const proto = Object.getPrototypeOf(rsReader);

  t.deepEqual(Object.getOwnPropertyNames(proto).sort(), properties);

  for (const m of methods) {
    const propDesc = Object.getOwnPropertyDescriptor(proto, m);
    t.equal(propDesc.enumerable, false, `${m} should be non-enumerable`);
    t.equal(propDesc.configurable, true, `${m} should be configurable`);
    t.equal(propDesc.writable, true, `${m} should be writable`);
    t.equal(typeof rsReader[m], 'function', `should have a ${m} method`);
  }

  const closedPropDesc = Object.getOwnPropertyDescriptor(proto, 'closed');
  t.equal(closedPropDesc.enumerable, false, 'closed should be non-enumerable');
  t.equal(closedPropDesc.configurable, true, 'closed should be configurable');
  t.notEqual(closedPropDesc.get, undefined, 'closed should have a getter');
  t.equal(closedPropDesc.set, undefined, 'closed should not have a setter');

  t.equal(rsReader.cancel.length, 1, 'cancel has 1 parameter');
  t.notEqual(rsReader.closed, undefined, 'has a non-undefined closed property');
  t.equal(typeof rsReader.closed.then, 'function', 'closed property is thenable');
  t.equal(typeof rsReader.constructor, 'function', 'has a constructor method');
  t.equal(rsReader.constructor.length, 1, 'constructor has 1 parameter');
  t.equal(typeof rsReader.read, 'function', 'has a getReader method');
  t.equal(rsReader.read.length, 0, 'read has no parameters');
  t.equal(typeof rsReader.releaseLock, 'function', 'has a releaseLock method');
  t.equal(rsReader.releaseLock.length, 0, 'releaseLock has no parameters');

  t.end();
});

test('ReadableStreamReader closed should always return the same promise object', t => {
  const rsReader = new ReadableStreamReader(new ReadableStream());

  t.equal(rsReader.closed, rsReader.closed, 'closed should return the same promise');

  t.end();
});

test('Constructing a ReadableStreamReader directly should fail if the stream is already locked (via direct ' +
     'construction)', t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly the first time should be fine');
  t.throws(() => new ReadableStreamReader(rs), /TypeError/, 'constructing directly the second time should fail');
  t.end();
});

test('Getting a ReadableStreamReader via getReader should fail if the stream is already locked (via direct ' +
     'construction', t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should be fine');
  t.throws(() => rs.getReader(), /TypeError/, 'getReader() should fail');
  t.end();
});

test('Constructing a ReadableStreamReader directly should fail if the stream is already locked (via getReader)',
     t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => rs.getReader(), 'getReader() should be fine');
  t.throws(() => new ReadableStreamReader(rs), /TypeError/, 'constructing directly should fail');
  t.end();
});

test('Getting a ReadableStreamReader via getReader should fail if the stream is already locked (via getReader)',
     t => {
  const rs = new ReadableStream();
  t.doesNotThrow(() => rs.getReader(), 'getReader() should be fine');
  t.throws(() => rs.getReader(), /TypeError/, 'getReader() should fail');
  t.end();
});

test('Constructing a ReadableStreamReader directly should be OK if the stream is closed',
     t => {
  const rs = new ReadableStream({
    start(c) {
      c.close();
    }
  });

  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should not throw');
  t.end();
});

test('Constructing a ReadableStreamReader directly should be OK if the stream is errored',
     t => {
  const theError = new Error('don\'t say i didn\'t warn ya');
  const rs = new ReadableStream({
    start(c) {
      c.error(theError);
    }
  });

  t.doesNotThrow(() => new ReadableStreamReader(rs), 'constructing directly should not throw');
  t.end();
});

test('Reading from a reader for an empty stream will wait until a chunk is available', t => {
  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });
  const reader = rs.getReader();

  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false }, 'read() should fulfill with the enqueued chunk');
    t.end();
  });

  controller.enqueue('a');
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

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const reader = rs.getReader();
  reader.closed.then(() => {
    t.pass('reader closed should be fulfilled');
  });

  controller.close();
});

test('closed should be fulfilled after reader releases its lock (multiple stream locks)', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const reader1 = rs.getReader();

  reader1.releaseLock();

  const reader2 = rs.getReader();
  controller.close();

  reader1.closed.then(() => {
    t.pass('reader1 closed should be fulfilled');
  });

  reader2.closed.then(() => {
    t.pass('reader2 closed should be fulfilled');
  });
});

test('Multiple readers can access the stream in sequence', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.close();
    }
  });

  const reader1 = rs.getReader();
  reader1.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'reading the first chunk from reader1 works'));
  reader1.releaseLock();

  const reader2 = rs.getReader();
  reader2.read().then(r => t.deepEqual(r, { value: 'b', done: false }, 'reading the second chunk from reader2 works'));
  reader2.releaseLock();
});

test('Cannot use an already-released reader to unlock a stream again', t => {
  t.plan(1);

  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
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
    start(c) {
      c.enqueue('a');
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

test('Getting a second reader after erroring the stream should succeed', t => {
  t.plan(5);

  let controller;
  const theError = new Error('bad');
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const reader1 = rs.getReader();

  reader1.closed.catch(e => {
    t.equal(e, theError, 'the first reader closed getter should be rejected with the error');
  });

  reader1.read().catch(e => {
    t.equal(e, theError, 'the first reader read() should be rejected with the error');
  });

  t.throws(() => rs.getReader(), /TypeError/, 'trying to get another reader before erroring should throw');

  controller.error(theError);

  rs.getReader().closed.catch(e => {
    t.equal(e, theError, 'the second reader closed getter should be rejected with the error');
  });

  rs.getReader().read().catch(e => {
    t.equal(e, theError, 'the third reader read() should be rejected with the error');
  });
});

test('Garbage-collecting a ReadableStreamReader should not unlock its stream', t => {
  const rs = new ReadableStream({});

  rs.getReader();
  gc();

  t.throws(() => rs.getReader(), /TypeError/,
    'old reader should still be locking the stream even after garbage collection');
  t.end();
});

test('Reading twice on a stream that gets closed', t => {
  t.plan(3);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });
  const reader = rs.getReader();

  reader.read().then(result => t.deepEqual(result, { value: undefined, done: true }, 'read() should fulfill with close'));
  reader.read().then(result => t.deepEqual(result, { value: undefined, done: true }, 'read() should fulfill with close'));
  reader.closed.then(() => t.pass('closed promise was fulfilled'));

  controller.close();
});

test('Reading twice on a closed stream', t => {
  t.plan(3);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  controller.close();

  const reader = rs.getReader();

  reader.read().then(result => t.deepEqual(result, { value: undefined, done: true }, 'read() should fulfill with close'));
  reader.read().then(result => t.deepEqual(result, { value: undefined, done: true }, 'read() should fulfill with close'));
  reader.closed.then(() => t.pass('closed promise was fulfilled'));
});

test('Reading twice on an errored stream', t => {
  t.plan(3);

  var controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const myError = { potato: "mashed" };
  controller.error(myError);

  const reader = rs.getReader();

  reader.read().then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );
  reader.read().then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );
  reader.closed.then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );
});

test('Reading twice on a stream that gets errored', t => {
  t.plan(3);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const reader = rs.getReader();

  reader.read().then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );
  reader.read().then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );
  reader.closed.then(
    () => t.fail('read() should reject on an errored stream'),
    err => t.equal(err, myError, 'error is the one we passed')
  );

  const myError = { potato: 'mashed' };
  controller.error(myError);
});

test('Reading within a read promise resolve callback on a stream that gets closed', t => {
  t.plan(1);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const reader = rs.getReader();

  reader.read().then(() => reader.read().then(() => t.pass('read() succeeds')));
  controller.close();
});
