var test = require('tape');

import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import ExclusiveStreamReader from '../lib/exclusive-stream-reader';
import ByteLengthQueuingStrategy from '../lib/byte-length-queuing-strategy';
import CountQueuingStrategy from '../lib/count-queuing-strategy';

function fakeReadableStream() {
  return {
    get closed() { return Promise.resolve(); },
    get ready() { return Promise.resolve(); },
    get state() { return 'closed' },
    cancel(reason) { return Promise.resolve(); },
    getReader() { return new ExclusiveStreamReader(new ReadableStream()); },
    pipeThrough({ writable, readable }, options) { return readable; },
    pipeTo(dest, { preventClose, preventAbort, preventCancel } = {}) { return Promise.resolve(); },
    read() { return ''; }
  };
}

function realReadableStream() {
  return new ReadableStream();
}

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

function fakeExclusiveStreamReader() {
  return {
    get closed() { return Promise.resolve(); },
    get isActive() { return false; },
    get ready() { return Promise.resolve(); },
    get state() { return 'closed' },
    cancel(reason) { return Promise.resolve(); },
    read() { return ''; },
    releaseLock() { return; }
  };
}

function fakeByteLengthQueuingStrategy() {
  return {
    shouldApplyBackpressure(queueSize) {
      return queueSize > 1;
    },
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
    shouldApplyBackpressure(queueSize) {
      return queueSize > 1;
    },
    size(chunk) {
      return 1;
    }
  };
}

function realCountQueuingStrategy() {
  return new CountQueuingStrategy({ highWaterMark: 1 });
}

function getterRejects(t, obj, getterName, target) {
  var getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  getter.call(target).then(
    () => t.fail(getterName + ' should not fulfill'),
    e => t.equal(e.constructor, TypeError, getterName + ' should reject with a TypeError')
  );
}

function methodRejects(t, obj, methodName, target) {
  var method = obj[methodName];

  method.call(target).then(
    () => t.fail(methodName + ' should not fulfill'),
    e => t.equal(e.constructor, TypeError, methodName + ' should reject with a TypeError')
  );
}

function getterThrows(t, obj, getterName, target) {
  var getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  t.throws(() => getter.call(target), /TypeError/, getterName + ' should throw a TypeError');
}

function methodThrows(t, obj, methodName, target) {
  var method = obj[methodName];

  t.throws(() => method.call(target), /TypeError/, methodName + ' should throw a TypeError');
}

test('ReadableStream.prototype.closed enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, ReadableStream.prototype, 'closed', fakeReadableStream());
  getterRejects(t, ReadableStream.prototype, 'closed', realWritableStream());
});

test('ReadableStream.prototype.ready enforces a brand check', t => {
  t.plan(2);
  getterRejects(t, ReadableStream.prototype, 'ready', fakeReadableStream());
  getterRejects(t, ReadableStream.prototype, 'ready', realWritableStream());
});

test('ReadableStream.prototype.state enforces a brand check', t => {
  t.plan(2);
  getterThrows(t, ReadableStream.prototype, 'state', fakeReadableStream());
  getterThrows(t, ReadableStream.prototype, 'state', realWritableStream());
});

test('ReadableStream.prototype.cancel enforces a brand check', t => {
  t.plan(2);
  methodRejects(t, ReadableStream.prototype, 'cancel', fakeReadableStream());
  methodRejects(t, ReadableStream.prototype, 'cancel', realWritableStream());
});

test('ReadableStream.prototype.getReader enforces a brand check', t => {
  t.plan(2);
  methodThrows(t, ReadableStream.prototype, 'getReader', fakeReadableStream());
  methodThrows(t, ReadableStream.prototype, 'getReader', realWritableStream());
});

test('ReadableStream.prototype.pipeThrough works generically on its this and its arguments', t => {
  t.plan(2);

  var pipeToArguments;
  var thisValue = {
    pipeTo(...args) {
      pipeToArguments = args;
    }
  };

  var input = { readable: {}, writable: {} };
  var options = {};
  var result = ReadableStream.prototype.pipeThrough.call(thisValue, input, options);

  t.deepEqual(pipeToArguments, [input.writable, options], 'correct arguments should be passed to thisValue.pipeTo');
  t.equal(result, input.readable, 'return value should be the passed readable property');
});

test('ReadableStream.prototype.pipeTo works generically on its this and its arguments', t => {
  t.plan(1);

  // TODO: expand this with a full fake that records what happens to it?

  t.doesNotThrow(() => ReadableStream.prototype.pipeTo.call(fakeReadableStream(), fakeWritableStream()));
});

test('ReadableStream.prototype.putBack enforces a brand check', t => {
  t.plan(2);
  methodThrows(t, ReadableStream.prototype, 'putBack', fakeReadableStream());
  methodThrows(t, ReadableStream.prototype, 'putBack', realWritableStream());
});

test('ReadableStream.prototype.read enforces a brand check', t => {
  t.plan(2);
  methodThrows(t, ReadableStream.prototype, 'read', fakeReadableStream());
  methodThrows(t, ReadableStream.prototype, 'read', realWritableStream());
});


test('ExclusiveStreamReader enforces a brand check on its argument', t => {
  t.plan(1);
  t.throws(() => new ExclusiveStreamReader(fakeReadableStream()), /TypeError/, 'Contructing an ExclusiveStreamReader ' +
    'should throw');
});

test('ExclusiveStreamReader.prototype.closed enforces a brand check', t => {
  t.plan(1);
  getterRejects(t, ExclusiveStreamReader.prototype, 'closed', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.isActive enforces a brand check', t => {
  t.plan(1);
  getterThrows(t, ExclusiveStreamReader.prototype, 'isActive', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.ready enforces a brand check', t => {
  t.plan(1);
  getterRejects(t, ExclusiveStreamReader.prototype, 'ready', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.state enforces a brand check', t => {
  t.plan(1);
  getterThrows(t, ExclusiveStreamReader.prototype, 'state', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.cancel enforces a brand check', t => {
  t.plan(1);
  methodRejects(t, ExclusiveStreamReader.prototype, 'cancel', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.read enforces a brand check', t => {
  t.plan(1);
  methodThrows(t, ExclusiveStreamReader.prototype, 'read', fakeExclusiveStreamReader());
});

test('ExclusiveStreamReader.prototype.releaseLock enforces a brand check', t => {
  t.plan(1);
  methodThrows(t, ExclusiveStreamReader.prototype, 'releaseLock', fakeExclusiveStreamReader());
});


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


test('ByteLengthQueuingStrategy.prototype.shouldApplyBackpressure enforces a brand check', t => {
  t.plan(2);
  methodThrows(t, ByteLengthQueuingStrategy.prototype, 'shouldApplyBackpressure', fakeByteLengthQueuingStrategy());
  methodThrows(t, ByteLengthQueuingStrategy.prototype, 'shouldApplyBackpressure', realCountQueuingStrategy());
});

test('ByteLengthQueuingStrategy.prototype.size should work generically on its this and its arguments', t => {
  t.plan(1);
  var thisValue = null;
  var returnValue = { 'returned from': 'byteLength getter' };
  var chunk = {
    get byteLength() {
      return returnValue;
    }
  };

  t.equal(ByteLengthQueuingStrategy.prototype.size.call(thisValue, chunk), returnValue);
});

test('CountQueuingStrategy.prototype.shouldApplyBackpressure enforces a brand check', t => {
  t.plan(2);
  methodThrows(t, CountQueuingStrategy.prototype, 'shouldApplyBackpressure', fakeCountQueuingStrategy());
  methodThrows(t, CountQueuingStrategy.prototype, 'shouldApplyBackpressure', realByteLengthQueuingStrategy());
});

test('CountQueuingStrategy.prototype.size should work generically on its this and its arguments', t => {
  t.plan(1);
  var thisValue = null;
  var chunk = {
    get byteLength() {
      throw new TypeError('shouldn\'t be called');
    }
  };

  t.equal(CountQueuingStrategy.prototype.size.call(thisValue, chunk), 1);
});
