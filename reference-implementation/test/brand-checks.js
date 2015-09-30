const test = require('tape-catch');

function fakeWritableStream() {
  return {
    get closed() { return Promise.resolve(); },
    get ready() { return Promise.resolve(); },
    get state() { return 'closed' },
    abort(reason) { return Promise.resolve(); },
    close() { return Promise.resolve(); },
    write(chunk) { return Promise.resolve(); }
  };
}

function realWritableStream() {
  return new WritableStream();
}

function realReadableStream() {
  return new ReadableStream();
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


test('WritableStream.prototype.closed enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, WritableStream.prototype, 'closed', fakeWritableStream());
  getterRejects(t, WritableStream.prototype, 'closed', realReadableStream());
});

test('WritableStream.prototype.ready enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, WritableStream.prototype, 'ready', fakeWritableStream());
  getterRejects(t, WritableStream.prototype, 'ready', realReadableStream());
});

test('WritableStream.prototype.state enforces a brand check', t => {
  t.plan(2);
  getterThrows(t, WritableStream.prototype, 'state', fakeWritableStream());
  getterThrows(t, WritableStream.prototype, 'state', realReadableStream());
});

test('WritableStream.prototype.abort enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStream.prototype, 'abort', fakeWritableStream());
  methodRejects(t, WritableStream.prototype, 'abort', realReadableStream());
});

test('WritableStream.prototype.write enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStream.prototype, 'write', fakeWritableStream());
  methodRejects(t, WritableStream.prototype, 'write', realReadableStream());
});

test('WritableStream.prototype.close enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, WritableStream.prototype, 'close', fakeWritableStream());
  methodRejects(t, WritableStream.prototype, 'close', realReadableStream());
});
