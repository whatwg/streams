'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
}

test(() => {
  const ws = new WritableStream({});
  const writer = ws.getWriter();
  writer.releaseLock();

  assert_throws(new TypeError(), () => writer.desiredSize, 'desiredSize should throw a TypeError');
}, 'desiredSize on a released writer');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();

  assert_equals(writer.desiredSize, 1, 'desiredSize should be 1');
}, 'desiredSize initial value');

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();

  writer.close();

  return writer.closed.then(() => {
    assert_equals(writer.desiredSize, 0, 'desiredSize should be 0');
  });
}, 'desiredSize on a writer for a closed stream');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.close();
  writer.releaseLock();

  ws.getWriter();
}, 'ws.getWriter() on a closing WritableStream');

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  return writer.close().then(() => {
    writer.releaseLock();

    ws.getWriter();
  });
}, 'ws.getWriter() on a closed WritableStream');

test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.abort();
  writer.releaseLock();

  ws.getWriter();
}, 'ws.getWriter() on an aborted WritableStream');

promise_test(() => {
  const ws = new WritableStream({
    start(c) {
      c.error();
    }
  });

  const writer = ws.getWriter();
  return writer.closed.then(
    v => assert_unreached('writer.closed fulfilled unexpectedly with: ' + v),
    () => {
      writer.releaseLock();

      ws.getWriter();
    }
  );
}, 'ws.getWriter() on an errored WritableStream');

promise_test(() => {
  const ws = new WritableStream({});

  const writer = ws.getWriter();
  writer.releaseLock();

  return writer.closed.then(
    v => assert_unreached('writer.closed fulfilled unexpectedly with: ' + v),
    closedRejection => {
      assert_equals(closedRejection.name, 'TypeError', 'closed promise should reject with a TypeError');
      return writer.ready.then(
        v => assert_unreached('writer.ready fulfilled unexpectedly with: ' + v),
        readyRejection => assert_equals(readyRejection, closedRejection,
          'ready promise should reject with the same error')
      );
    }
  );
}, 'closed and ready on a released writer');

promise_test(() => {
  const promises = {};
  const resolvers = {};
  for (const methodName of ['start', 'write', 'close', 'abort']) {
    promises[methodName] = new Promise(resolve => {
      resolvers[methodName] = resolve;
    });
  }

  // Calls to Sink methods after the first are implicitly ignored. Only the first value that is passed to the resolver
  // is used.
  class Sink {
    start() {
      // Called twice
      resolvers.start(this);
    }

    write() {
      resolvers.write(this);
    }

    close() {
      resolvers.close(this);
    }

    abort() {
      resolvers.abort(this);
    }
  }

  const theSink = new Sink();
  const ws = new WritableStream(theSink);

  const writer = ws.getWriter();

  writer.write('a');
  writer.close();

  const ws2 = new WritableStream(theSink);
  const writer2 = ws2.getWriter();
  writer2.abort();

  return promises.start
      .then(thisValue => assert_equals(thisValue, theSink, 'start should be called as a method'))
      .then(() => promises.write)
      .then(thisValue => assert_equals(thisValue, theSink, 'write should be called as a method'))
      .then(() => promises.close)
      .then(thisValue => assert_equals(thisValue, theSink, 'close should be called as a method'))
      .then(() => promises.abort)
      .then(thisValue => assert_equals(thisValue, theSink, 'abort should be called as a method'));
}, 'WritableStream should call underlying sink methods as methods');

done();
