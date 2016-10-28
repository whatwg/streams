'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

test(() => {
  new TransformStream({ transform() { } });
}, 'TransformStream can be constructed with a transform function');

test(() => {
  new TransformStream();
  new TransformStream({});
}, 'TransformStream can be constructed with no transform function');

test(() => {
  const ts = new TransformStream({ transform() { } });
  const proto = Object.getPrototypeOf(ts);

  const writableStream = Object.getOwnPropertyDescriptor(proto, 'writable');
  assert_true(writableStream !== undefined, 'it has a writable property');
  assert_false(writableStream.enumerable, 'writable should be non-enumerable');
  assert_equals(typeof writableStream.get, 'function', 'writable should have a getter');
  assert_equals(writableStream.set, undefined, 'writable should not have a setter');
  assert_true(writableStream.configurable, 'writable should be configurable');
  assert_true(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');

  const readableStream = Object.getOwnPropertyDescriptor(proto, 'readable');
  assert_true(readableStream !== undefined, 'it has a readable property');
  assert_false(readableStream.enumerable, 'readable should be non-enumerable');
  assert_equals(typeof readableStream.get, 'function', 'readable should have a getter');
  assert_equals(readableStream.set, undefined, 'readable should not have a setter');
  assert_true(readableStream.configurable, 'readable should be configurable');
  assert_true(ts.writable instanceof WritableStream, 'writable is an instance of WritableStream');
}, 'TransformStream instances must have writable and readable properties of the correct types');

test(() => {
  const ts = new TransformStream({ transform() { } });

  const writer = ts.writable.getWriter();
  assert_equals(writer.desiredSize, 1, 'writer.desiredSize should be 1');
}, 'TransformStream writable starts in the writable state');
