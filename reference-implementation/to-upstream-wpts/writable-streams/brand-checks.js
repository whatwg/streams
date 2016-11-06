'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

function fakeWritableStreamDefaultWriter() {
  return {
    get closed() { return Promise.resolve(); },
    get desiredSize() { return 1; },
    get ready() { return Promise.resolve(); },
    abort() { return Promise.resolve(); },
    close() { return Promise.resolve(); },
    write() { return Promise.resolve(); }
  };
}

function realReadableStreamDefaultWriter() {
  const rs = new ReadableStream();
  return rs.getReader();
}

function getterRejects(t, obj, getterName, target) {
  const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  return promise_rejects(t, new TypeError(), getter.call(target),
    getterName + ' should reject with a TypeError');
}

function methodRejects(t, obj, methodName, target) {
  const method = obj[methodName];

  return promise_rejects(t, new TypeError(), method.call(target),
    methodName + ' should reject with a TypeError');
}

function getterThrows(obj, getterName, target) {
  const getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

  assert_throws(new TypeError(), () => getter.call(target), getterName + ' should throw a TypeError');
}

const ws = new WritableStream();
const writer = ws.getWriter();
const WritableStreamDefaultWriter = writer.constructor;
const WriterProto = WritableStreamDefaultWriter.prototype;

test(() => {
  getterThrows(WriterProto, 'desiredSize', fakeWritableStreamDefaultWriter());
  getterThrows(WriterProto, 'desiredSize', realReadableStreamDefaultWriter());
}, 'WritableStreamDefaultWriter.prototype.desiredSize enforces a brand check');

promise_test(t => {
  const results = [];

  results.push(getterRejects(t, WriterProto, 'closed', fakeWritableStreamDefaultWriter()));
  results.push(getterRejects(t, WriterProto, 'closed', realReadableStreamDefaultWriter()));

  return Promise.all(results);
}, 'WritableStreamDefaultWriter.prototype.closed enforces a brand check');

promise_test(t => {
  const results = [];

  results.push(getterRejects(t, WriterProto, 'ready', fakeWritableStreamDefaultWriter()));
  results.push(getterRejects(t, WriterProto, 'ready', realReadableStreamDefaultWriter()));

  return Promise.all(results);
}, 'WritableStreamDefaultWriter.prototype.ready enforces a brand check');

test(t => {
  const results = [];

  results.push(methodRejects(t, WriterProto, 'abort', fakeWritableStreamDefaultWriter()));
  results.push(methodRejects(t, WriterProto, 'abort', realReadableStreamDefaultWriter()));

  return Promise.all(results);
}, 'WritableStreamDefaultWriter.prototype.abort enforces a brand check');

promise_test(t => {
  const results = [];

  results.push(methodRejects(t, WriterProto, 'write', fakeWritableStreamDefaultWriter()));
  results.push(methodRejects(t, WriterProto, 'write', realReadableStreamDefaultWriter()));

  return Promise.all(results);
}, 'WritableStreamDefaultWriter.prototype.write enforces a brand check');

promise_test(t => {
  const results = [];

  results.push(methodRejects(t, WriterProto, 'close', fakeWritableStreamDefaultWriter()));
  results.push(methodRejects(t, WriterProto, 'close', realReadableStreamDefaultWriter()));

  return Promise.all(results);
}, 'WritableStreamDefaultWriter.prototype.close enforces a brand check');
