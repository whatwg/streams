'use strict';
const test = require('tape-catch');

test('Underlying sink: throwing start getter', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      get start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Underlying sink: throwing start method', t => {
  const theError = new Error('a unique string');

  t.throws(() => {
    new WritableStream({
      start() {
        throw theError;
      }
    });
  }, /a unique string/);
  t.end();
});

test('Underlying sink: non-function start', t => {
  t.throws(() => {
    new WritableStream({
      start: 'not a function or undefined'
    });
  }, /TypeError/);
  t.end();
});

test('Underlying sink: non-function start with .apply', t => {
  t.throws(() => {
    new WritableStream({
      start: { apply() {} }
    });
  }, /TypeError/);
  t.end();
});

test('Underlying sink: throwing write getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    get write() {
      throw theError;
    }
  });

  const writer = ws.getWriter();

  writer.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  writer.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying sink: throwing write method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    write() {
      throw theError;
    }
  });

  const writer = ws.getWriter();

  writer.write('a').then(
    () => t.fail('write should not fulfill'),
    r => t.equal(r, theError, 'write should reject with the thrown error')
  );

  writer.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r, theError, 'closed should reject with the thrown error')
  );
});

test('Underlying sink: throwing abort getter', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const abortReason = new Error('different string');
  const ws = new WritableStream({
    get abort() {
      throw theError;
    }
  });

  const writer = ws.getWriter();

  writer.abort(abortReason).then(
    () => t.fail('abort should not fulfill'),
    r => t.equal(r, theError, 'abort should reject with the abort reason')
  );

  writer.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r.constructor, TypeError, 'closed should reject with a TypeError')
  );
});

test('Underlying sink: throwing abort method', t => {
  t.plan(2);

  const theError = new Error('a unique string');
  const abortReason = new Error('different string');
  const ws = new WritableStream({
    abort() {
      throw theError;
    }
  });

  const writer = ws.getWriter();

  writer.abort(abortReason).then(
    () => t.fail('abort should not fulfill'),
    r => t.equal(r, theError, 'abort should reject with the abort reason')
  );

  writer.closed.then(
    () => t.fail('closed should not fulfill'),
    r => t.equal(r.constructor, TypeError, 'closed should reject with a TypeError')
  );
});

test('Underlying sink: throwing close getter', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    get close() {
      throw theError;
    }
  });

  const writer = ws.getWriter();
  writer.close().then(
    () => t.fail('close should not fulfill'),
    r => t.equal(r, theError, 'close should reject with the thrown error')
  );
});

test('Underlying sink: throwing close method', t => {
  t.plan(1);

  const theError = new Error('a unique string');
  const ws = new WritableStream({
    close() {
      throw theError;
    }
  });

  const writer = ws.getWriter();
  writer.close().then(
    () => t.fail('close should not fulfill'),
    r => t.equal(r, theError, 'close should reject with the thrown error')
  );
});
