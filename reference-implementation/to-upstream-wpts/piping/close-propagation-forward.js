'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/recording-streams.js');
}

const error1 = new Error('error1!');
error1.name = 'error1';

promise_test(() => {

  const rs = recordingReadableStream({
    start(controller) {
      controller.close();
    }
  });

  const ws = recordingWritableStream();

  return rs.pipeTo(ws).then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.events, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      ws.getWriter().closed
    ]);
  });

}, 'Closing must be propagated forward: starts closed; preventClose omitted; fulfilled close promise');

promise_test(t => {

  const rs = recordingReadableStream({
    start(controller) {
      controller.close();
    }
  });

  const ws = recordingWritableStream({
    close() {
      throw error1;
    }
  });

  return promise_rejects(t, error1, rs.pipeTo(ws), 'pipeTo must reject with the same error').then(() => {
    assert_array_equals(rs.events, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      promise_rejects(t, error1, ws.getWriter().closed)
    ]);
  });

}, 'Closing must be propagated forward: starts closed; preventClose omitted; rejected close promise');

for (const falsy of [undefined, null, false, +0, -0, NaN, '']) {
  promise_test(() => {

    const rs = recordingReadableStream({
      start(controller) {
        controller.close();
      }
    });

    const ws = recordingWritableStream();

    return rs.pipeTo(ws, { preventClose: falsy }).then(value => {
      assert_equals(value, undefined, 'the promise must fulfill with undefined');
    })
    .then(() => {
      assert_array_equals(rs.events, []);
      assert_array_equals(ws.events, ['close']);

      return Promise.all([
        rs.getReader().closed,
        ws.getWriter().closed
      ]);
    });

  }, `Closing must be propagated forward: starts closed; preventClose = ${falsy} (falsy); fulfilled close promise`);
}

for (const truthy of [true, 'a', 1, Symbol(), { }]) {
  promise_test(() => {

    const rs = recordingReadableStream({
      start(controller) {
        controller.close();
      }
    });

    const ws = recordingWritableStream();

    return rs.pipeTo(ws, { preventClose: truthy }).then(value => {
      assert_equals(value, undefined, 'the promise must fulfill with undefined');
    })
    .then(() => {
      assert_array_equals(rs.events, []);
      assert_array_equals(ws.events, []);

      return rs.getReader().closed;
    });

  }, `Closing must be propagated forward: starts closed; preventClose = ${String(truthy)} (truthy)`);
}

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream();

  const pipePromise = rs.pipeTo(ws);

  setTimeout(() => rs.controller.close());

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      ws.getWriter().closed
    ]);
  });

}, 'Closing must be propagated forward: becomes closed while empty; preventClose omitted; fulfilled close promise');

promise_test(t => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream({
    close() {
      throw error1;
    }
  });

  const pipePromise = promise_rejects(t, error1, rs.pipeTo(ws), 'pipeTo must reject with the same error');

  setTimeout(() => rs.controller.close());

  return pipePromise.then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      promise_rejects(t, error1, ws.getWriter().closed)
    ]);
  });

}, 'Closing must be propagated forward: becomes closed while empty; preventClose omitted; rejected close promise');

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream();

  const pipePromise = rs.pipeTo(ws, { preventClose: true });

  setTimeout(() => rs.controller.close());

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, []);

    return rs.getReader().closed;
  });

}, 'Closing must be propagated forward: becomes closed while empty; preventClose = true');

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream(undefined, new CountQueuingStrategy({ highWaterMark: 0 }));

  const pipePromise = rs.pipeTo(ws);

  setTimeout(() => rs.controller.close());

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      ws.getWriter().closed
    ]);
  });

}, 'Closing must be propagated forward: becomes closed while empty; dest never desires chunks; ' +
   'preventClose omitted; fulfilled close promise');

promise_test(t => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream({
    close() {
      throw error1;
    }
  }, new CountQueuingStrategy({ highWaterMark: 0 }));

  const pipePromise = promise_rejects(t, error1, rs.pipeTo(ws), 'pipeTo must reject with the same error');

  setTimeout(() => rs.controller.close());

  return pipePromise.then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['close']);

    return Promise.all([
      rs.getReader().closed,
      promise_rejects(t, error1, ws.getWriter().closed)
    ]);
  });

}, 'Closing must be propagated forward: becomes closed while empty; dest never desires chunks; ' +
   'preventClose omitted; rejected close promise');

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream(undefined, new CountQueuingStrategy({ highWaterMark: 0 }));

  const pipePromise = rs.pipeTo(ws, { preventClose: true });

  setTimeout(() => rs.controller.close());

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, []);

    return rs.getReader().closed;
  });

}, 'Closing must be propagated forward: becomes closed while empty; dest never desires chunks; ' +
   'preventClose = true');

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream();

  const pipePromise = rs.pipeTo(ws);

  setTimeout(() => {
    rs.controller.enqueue('Hello');
    setTimeout(() => rs.controller.close());
  }, 10);

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['write', 'Hello', 'close']);

    return Promise.all([
      rs.getReader().closed,
      ws.getWriter().closed
    ]);
  });

}, 'Closing must be propagated forward: becomes closed after one chunk; preventClose omitted; fulfilled close promise');

promise_test(t => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream({
    close() {
      throw error1;
    }
  });

  const pipePromise = promise_rejects(t, error1, rs.pipeTo(ws), 'pipeTo must reject with the same error');

  setTimeout(() => {
    rs.controller.enqueue('Hello');
    setTimeout(() => rs.controller.close());
  }, 10);

  return pipePromise.then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['write', 'Hello', 'close']);

    return Promise.all([
      rs.getReader().closed,
      promise_rejects(t, error1, ws.getWriter().closed)
    ]);
  });

}, 'Closing must be propagated forward: becomes closed after one chunk; preventClose omitted; rejected close promise');

promise_test(() => {

  const rs = recordingReadableStream();

  const ws = recordingWritableStream();

  const pipePromise = rs.pipeTo(ws, { preventClose: true });

  setTimeout(() => {
    rs.controller.enqueue('Hello');
    setTimeout(() => rs.controller.close());
  }, 10);

  return pipePromise.then(value => {
    assert_equals(value, undefined, 'the promise must fulfill with undefined');
  })
  .then(() => {
    assert_array_equals(rs.eventsWithoutPulls, []);
    assert_array_equals(ws.events, ['write', 'Hello']);

    return rs.getReader().closed;
  });

}, 'Closing must be propagated forward: becomes closed after one chunk; preventClose = true');

promise_test(() => {

  const rs = recordingReadableStream();

  let resolveWritePromise;
  const ws = recordingWritableStream({
    write() {
      return new Promise(resolve => {
        resolveWritePromise = resolve;
      });
    }
  });

  let pipeComplete = false;
  const pipePromise = rs.pipeTo(ws).then(() => {
    pipeComplete = true;
  });

  rs.controller.enqueue('a');
  rs.controller.close();

  // Ensure that within 50 ms, at least, no shutdown occurs.
  return delay(50).then(() => {
    assert_array_equals(ws.events, ['write', 'a']); // no 'close'
    assert_equals(pipeComplete, false, 'the pipe must not be complete');

    resolveWritePromise();

    return pipePromise.then(() => {
      assert_array_equals(ws.events, ['write', 'a', 'close']);
    });
  });

}, 'Closing must be propagated forward: shutdown must not occur until the final write completes');
