const test = require('tape-catch');

import readableStreamToArray from './utils/readable-stream-to-array';

test('ReadableStream teeing: rs.tee() returns an array of two ReadableStreams', t => {
  const rs = new ReadableStream();

  const result = rs.tee();

  t.ok(Array.isArray(result), 'return value should be an array');
  t.equal(result.length, 2, 'array should have length 2');
  t.equal(result[0].constructor, ReadableStream, '0th element should be a ReadableStream');
  t.equal(result[1].constructor, ReadableStream, '1st element should be a ReadableStream');
  t.end();
});

test('ReadableStream teeing: should be able to read one branch to the end without affecting the other', t => {
  t.plan(5);

  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.close();
    }
  });

  const [branch1, branch2] = rs.tee();
  const [reader1, reader2] = [branch1.getReader(), branch2.getReader()];

  reader1.closed.then(() => t.pass('branch1 should be closed')).catch(e => t.error(e));
  reader2.closed.then(() => t.fail('branch2 should not be closed'));

  reader1.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'first chunk from branch1 should be correct'));
  reader1.read().then(r => t.deepEqual(r, { value: 'b', done: false }, 'second chunk from branch1 should be correct'));
  reader1.read().then(r => t.deepEqual(r, { value: undefined, done: true },
    'third read() from branch1 should be done'));

  reader2.read().then(r => t.deepEqual(r, { value: 'a', done: false }, 'first chunk from branch2 should be correct'));
});

test('ReadableStream teeing: values should be equal across each branch', t => {
  t.plan(1);

  const theObject = { the: 'test object' };
  const rs = new ReadableStream({
    start(c) {
      c.enqueue(theObject);
    }
  });

  const [branch1, branch2] = rs.tee();
  const [reader1, reader2] = [branch1.getReader(), branch2.getReader()];

  Promise.all([reader1.read(), reader2.read()]).then(([{ value: value1 }, { value: value2 }]) => {
    t.equal(value1, value2, 'the values should be equal');
  });
});

test('ReadableStream teeing: errors in the source should propagate to both branches', t => {
  t.plan(6);

  const theError = new Error('boo!');
  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
    },
    pull() {
      throw theError;
    }
  });

  const [branch1, branch2] = rs.tee();
  const [reader1, reader2] = [branch1.getReader(), branch2.getReader()];

  reader1.label = 'reader1';
  reader2.label = 'reader2';

  reader1.closed.catch(e => t.equal(e, theError, 'branch1 closed promise should reject with the error'));
  reader2.closed.catch(e => t.equal(e, theError, 'branch2 closed promise should reject with the error'));

  reader1.read().then(r => t.deepEqual(r, { value: 'a', done: false },
    'should be able to read the first chunk in branch1'));

  reader1.read().then(r => {
    t.deepEqual(r, { value: 'b', done: false }, 'should be able to read the second chunk in branch1');

    return reader2.read().then(
      () => t.fail('once the root stream has errored, you should not be able to read from branch2'),
      e => t.equal(e, theError, 'branch2 read() promise should reject with the error')
    );
  })
  .then(() => {
    return reader1.read().then(
      () => t.fail('once the root stream has errored, you should not be able to read from branch1 either'),
      e => t.equal(e, theError, 'branch1 read() promise should reject with the error')
    );
  })
  .catch(e => t.error(e));
});

test('ReadableStream teeing: canceling branch1 should not impact branch2', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.close();
    }
  });

  const [branch1, branch2] = rs.tee();
  branch1.cancel();

  readableStreamToArray(branch1).then(chunks => t.deepEqual(chunks, [], 'branch1 should have no chunks'));
  readableStreamToArray(branch2).then(chunks => t.deepEqual(chunks, ['a', 'b'], 'branch2 should have two chunks'));
});

test('ReadableStream teeing: canceling branch2 should not impact branch1', t => {
  t.plan(2);

  const rs = new ReadableStream({
    start(c) {
      c.enqueue('a');
      c.enqueue('b');
      c.close();
    }
  });

  const [branch1, branch2] = rs.tee();
  branch2.cancel();

  readableStreamToArray(branch1).then(chunks => t.deepEqual(chunks, ['a', 'b'], 'branch1 should have two chunks'));
  readableStreamToArray(branch2).then(chunks => t.deepEqual(chunks, [], 'branch2 should have no chunks'));
});

test('ReadableStream teeing: canceling both branches should aggregate the cancel reasons into an array', t => {
  t.plan(1);

  const reason1 = new Error('We\'re wanted men.');
  const reason2 = new Error('I have the death sentence on twelve systems.');

  const rs = new ReadableStream({
    cancel(reason) {
      t.deepEqual(reason, [reason1, reason2],
        'the cancel reason should be an array containing those from the branches');
    }
  });

  const [branch1, branch2] = rs.tee();
  branch1.cancel(reason1);
  branch2.cancel(reason2);
});

test('ReadableStream teeing: failing to cancel the original stream should cause cancel() to reject on branches', t => {
  t.plan(2);

  const theError = new Error('I\'ll be careful.');
  const rs = new ReadableStream({
    cancel() {
      throw theError;
    }
  });

  const [branch1, branch2] = rs.tee();
  branch1.cancel().catch(e => t.equal(e, theError, 'branch1.cancel() should reject with the error'));
  branch2.cancel().catch(e => t.equal(e, theError, 'branch2.cancel() should reject with the error'));
});

test('ReadableStream teeing: closing the original should immediately close the branches', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const [branch1, branch2] = rs.tee();
  const [reader1, reader2] = [branch1.getReader(), branch2.getReader()];

  reader1.closed.then(() => t.pass('branch1 should be closed')).catch(e => t.error(e));
  reader2.closed.then(() => t.pass('branch2 should be closed')).catch(e => t.error(e));

  controller.close();
});

test('ReadableStream teeing: erroring the original should immediately error the branches', t => {
  t.plan(2);

  let controller;
  const rs = new ReadableStream({
    start(c) {
      controller = c;
    }
  });

  const [branch1, branch2] = rs.tee();
  const [reader1, reader2] = [branch1.getReader(), branch2.getReader()];

  const theError = new Error('boo!');

  reader1.closed.then(
    () => t.fail('branch1 should not be closed'),
    e => t.equal(e, theError, 'branch1 should be errored with the error')
  );
  reader2.closed.then(
    () => t.fail('branch2 should not be closed'),
    e => t.equal(e, theError, 'branch2 should be errored with the error')
  );

  controller.error(theError);
});
