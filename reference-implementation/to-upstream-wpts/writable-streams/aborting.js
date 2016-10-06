'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

const error1 = new Error('error1');
error1.name = 'error1';

promise_test(t => {

  const ws = new WritableStream({
    write() {
      return new Promise(() => { }); // forever-pending, so normally .ready would not fulfill.
    }
  });

  const writer = ws.getWriter();
  writer.write('a');

  const readyPromise = writer.ready;

  writer.abort(error1);

  assert_equals(writer.ready, readyPromise, 'the ready promise property should not change');

  return promise_rejects(t, new TypeError(), readyPromise, 'the ready promise should reject with a TypeError');

}, 'Aborting a WritableStream should cause the writer\'s unsettled ready promise to reject');

promise_test(t => {

  const ws = new WritableStream();

  const writer = ws.getWriter();
  writer.write('a');

  const readyPromise = writer.ready;

  return readyPromise.then(() => {
    writer.abort(error1);

    assert_not_equals(writer.ready, readyPromise, 'the ready promise property should change');
    return promise_rejects(t, new TypeError(), writer.ready, 'the ready promise should reject with a TypeError');
  });

}, 'Aborting a WritableStream should cause the writer\'s fulfilled ready promise to reset to a rejected one');
