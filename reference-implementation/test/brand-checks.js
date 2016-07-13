'use strict';
const test = require('tape-catch');

function fakeWritableStreamDefaultWriter() {
  return {
    get closed() { return Promise.resolve(); },
    get desiredSize() { return 1; },
    get ready() { return Promise.resolve(); },
    abort(reason) { return Promise.resolve(); },
    close() { return Promise.resolve(); },
    write(chunk) { return Promise.resolve(); }
  };
}

function realReadableStreamDefaultWriter() {
  const rs = new ReadableStream();
  return rs.getReader();
}

function fakeByteLengthQueuingStrategy() {
  return {
    highWaterMark: 0,
    size(chunk) {
      return chunk.byteLength;
    }
  };
}

function realByteLengthQueuingStrategy() {
  return new ByteLengthQueuingStrategy({ highWaterMark: 1 });
}

function fakeCountQueuingStrategy() {
  return {
    highWaterMark: 0,
    size(chunk) {
      return 1;
    }
  };
}

function realCountQueuingStrategy() {
  return new CountQueuingStrategy({ highWaterMark: 1 });
}

function getterRejects(t, obj, getterName, target) {
  const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  getter.call(target).then(
    () => t.fail(getterName + ' should not fulfill'),
    e => t.equal(e.constructor, TypeError, getterName + ' should reject with a TypeError')
  );
}

function methodRejects(t, obj, methodName, target) {
  const method = obj[methodName];

  method.call(target).then(
    () => t.fail(methodName + ' should not fulfill'),
    e => t.equal(e.constructor, TypeError, methodName + ' should reject with a TypeError')
  );
}

function getterThrows(t, obj, getterName, target) {
  const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  t.throws(() => getter.call(target), /TypeError/, getterName + ' should throw a TypeError');
}

function methodThrows(t, obj, methodName, target) {
  const method = obj[methodName];

  t.throws(() => method.call(target), /TypeError/, methodName + ' should throw a TypeError');
}

const ws = new WritableStream();
const writer = ws.getWriter();
const WritableStreamDefaultWriter = writer.constructor;

test('WritableStreamDefaultWriter.prototype.closed enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'closed', fakeWritableStreamDefaultWriter());
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'closed', realReadableStreamDefaultWriter());
});

test('WritableStreamDefaultWriter.prototype.desiredSize enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'desiredSize', fakeWritableStreamDefaultWriter());
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'desiredSize', realReadableStreamDefaultWriter());
});

test('WritableStreamDefaultWriter.prototype.ready enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'ready', fakeWritableStreamDefaultWriter());
  getterRejects(t, WritableStreamDefaultWriter.prototype, 'ready', realReadableStreamDefaultWriter());
});

test('WritableStreamDefaultWriter.prototype.abort enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'abort', fakeWritableStreamDefaultWriter());
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'abort', realReadableStreamDefaultWriter());
});

test('WritableStreamDefaultWriter.prototype.write enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'write', fakeWritableStreamDefaultWriter());
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'write', realReadableStreamDefaultWriter());
});

test('WritableStreamDefaultWriter.prototype.close enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'close', fakeWritableStreamDefaultWriter());
  methodRejects(t, WritableStreamDefaultWriter.prototype, 'close', realReadableStreamDefaultWriter());
});
