'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

test(() => {
  assert_throws(new TypeError(), () => {
    new WritableStream({}, { size: 'a string' });
  });
}, 'reject any non-function value for strategy.size');

done();
