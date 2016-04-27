'use strict';
const test = require('tape-catch');

test('ReadableStream with byte source can be constructed with no errors', t => {
  t.doesNotThrow(
      () => new ReadableStream({ type: 'bytes' }),
      'ReadableStream with byte source constructed with an empty underlying byte source object as parameter');
  t.end();
});

test('ReadableStream with byte source: Construct and expect start and pull being called', t => {
  let startCalled = false;
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
      startCalled = true;
    },
    pull() {
      t.ok(startCalled, 'start has been called');
      t.equals(controller.desiredSize, 256, 'desiredSize');
      t.end();
    },
    type: 'bytes'
  }, {
    highWaterMark: 256
  });
});

test('ReadableStream with byte source: No automatic pull call if start doesn\'t finish', t => {
  let pullCount = 0;
  let checkedNoPull = false;

  let resolveStartPromise;

  const stream = new ReadableStream({
    start() {
      return new Promise((resolve) => {
        resolveStartPromise = resolve;
      });
    },
    pull() {
      if (checkedNoPull) {
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  }, {
    highWaterMark: 256
  });

  Promise.resolve().then(() => {
    t.equals(pullCount, 0);
    checkedNoPull = true;
    resolveStartPromise();
  });
});

test('ReadableStream with byte source: Construct with highWaterMark of 0', t => {
  const stream = new ReadableStream({
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  }, {
    highWaterMark: 0
  });

  Promise.resolve().then(() => {
    t.end();
  });
});

test('ReadableStream with byte source: getReader(), then releaseLock()', t => {
  const stream = new ReadableStream({
    type: 'bytes'
  });

  const reader = stream.getReader();
  reader.releaseLock();

  reader.closed.then(() => {
    t.fail('closed must be rejected');
    t.end();
  }).catch(e => {
    t.end();
  });
});

test('ReadableStream with byte source: getReader() with mode set to byob, then releaseLock()', t => {
  const stream = new ReadableStream({
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});
  reader.releaseLock();

  reader.closed.then(() => {
    t.fail('closed must be rejected');
    t.end();
  }).catch(e => {
    t.end();
  });
});

test('ReadableStream with byte source: Test that closing a stream does not release a reader automatically', t => {
  const stream = new ReadableStream({
    start(c) {
      c.close();
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.closed.then(() => {
    try {
      stream.getReader();
    } catch(e) {
      t.equals(e.constructor, TypeError);
      t.end();
      return;
    }

    t.fail('getReader() must fail');
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Test that closing a stream does not release a BYOB reader automatically', t => {
  const stream = new ReadableStream({
    start(c) {
      c.close();
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.closed.then(() => {
    try {
      stream.getReader({mode: 'byob'});
    } catch(e) {
      t.equals(e.constructor, TypeError);
      t.end();
      return;
    }

    t.fail('getReader() must fail');
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Test that erroring a stream does not release a reader automatically', t => {
  const passedError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.error(passedError);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.closed.then(() => {
    t.fail('closed must be rejected');
    t.end();
  }, e => {
    t.equals(e, passedError);

    try {
      stream.getReader();
    } catch(e) {
      t.equals(e.constructor, TypeError);
      t.end();
      return;
    }

    t.fail('getReader() must fail');
    t.end();
  });
});

test('ReadableStream with byte source: Test that erroring a stream does not release a BYOB reader automatically',
     t => {
  const passedError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.error(passedError);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.closed.then(() => {
    t.fail('closed must be rejected');
    t.end();
  }, e => {
    t.equals(e, passedError);

    try {
      stream.getReader({mode: 'byob'});
    } catch(e) {
      t.equals(e.constructor, TypeError);
      t.end();
      return;
    }

    t.fail('getReader() must fail');
    t.end();
  });
});

test('ReadableStream with byte source: releaseLock() on ReadableStreamReader with pending read() must throw', t => {
  const stream = new ReadableStream({
    type: 'bytes'
  });

  const reader = stream.getReader();
  reader.read();
  try {
    reader.releaseLock();
  } catch(e) {
    t.equals(e.constructor, TypeError);

    t.end();

    return;
  }

  t.fail('reader.releaseLock() didn\'t throw');
  t.end();
});

test('ReadableStream with byte source: Automatic pull() after start()', t => {
  let pullCount = 0;

  const stream = new ReadableStream({
    pull() {
      ++pullCount;
    },
    type: 'bytes'
  }, {
    highWaterMark: 8
  });

  const reader = stream.getReader();

  t.equals(pullCount, 0, 'No pull as start() just finished and is not yet reflected to the state of the stream');

  Promise.resolve().then(() => {
    t.equals(pullCount, 1, 'pull must be invoked');

    t.end();
  });
});

test('ReadableStream with byte source: Automatic pull() after start() and read()', t => {
  let pullCount = 0;

  const stream = new ReadableStream({
    pull() {
      ++pullCount;
    },
    type: 'bytes'
  }, {
    highWaterMark: 0
  });

  const reader = stream.getReader();
  reader.read();

  t.equals(pullCount, 0, 'No pull as start() just finished and is not yet reflected to the state of the stream');

  Promise.resolve().then(() => {
    t.equals(pullCount, 1, 'pull must be invoked');

    t.end();
  });
});

test('ReadableStream with byte source: autoAllocateChunkSize', t => {
  let pullCount = 0;
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        const byobRequest = controller.byobRequest;
        t.notEqual(byobRequest, undefined, 'byobRequest must not be undefined');

        const view = byobRequest.view;
        t.notEqual(view, undefined, 'byobRequest.view must no be undefined');
        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 16);
        t.equals(view.byteOffset, 0);
        t.equals(view.byteLength, 16);

        view[0] = 0x01;
        byobRequest.respond(1);
      } else {
        t.fail('Too many pull() calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes',
    autoAllocateChunkSize: 16
  }, {
    highWaterMark: 0
  });

  const reader = stream.getReader();
  const readPromise = reader.read();

  t.equals(pullCount, 0, 'No pull() as start() just finished and is not yet reflected to the state of the stream');

  Promise.resolve().then(() => {
    t.equals(pullCount, 1, 'pull() must have been invoked once');
    return readPromise;
  }).then(result => {
    t.notEqual(result.value, undefined);
    t.equals(result.value.constructor, Uint8Array);
    t.equals(result.value.buffer.byteLength, 16);
    t.equals(result.value.byteOffset, 0);
    t.equals(result.value.byteLength, 1);
    t.equals(result.value[0], 0x01);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Mix of auto allocate and BYOB', t => {
  let pullCount = 0;
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        const byobRequest = controller.byobRequest;
        t.notEqual(byobRequest, undefined, 'byobRequest must not be undefined');

        const view = byobRequest.view;
        t.notEqual(view, undefined, 'byobRequest.view must no be undefined');
        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 16);
        t.equals(view.byteOffset, 0);
        t.equals(view.byteLength, 16);

        view[0] = 0x01;
        byobRequest.respond(1);
      } else if (pullCount === 1) {
        const byobRequest = controller.byobRequest;
        t.notEqual(byobRequest, undefined, 'byobRequest must not be undefined');

        const view = byobRequest.view;
        t.notEqual(view, undefined, 'byobRequest.view must no be undefined');
        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 32);
        t.equals(view.byteOffset, 0);
        t.equals(view.byteLength, 32);

        view[0] = 0x02;
        view[1] = 0x03;
        byobRequest.respond(2);
      } else {
        t.fail('Too many pull() calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes',
    autoAllocateChunkSize: 16
  }, {
    highWaterMark: 0
  });

  const reader = stream.getReader();
  reader.read().then(result => {
    t.notEqual(result.value, undefined);
    t.equals(result.value.constructor, Uint8Array);
    t.equals(result.value.buffer.byteLength, 16);
    t.equals(result.value.byteOffset, 0);
    t.equals(result.value.byteLength, 1);
    t.equals(result.value[0], 0x01);

    reader.releaseLock();
    const byobReader = stream.getReader({mode: 'byob'});
    return byobReader.read(new Uint8Array(32));
  }).then(result => {
    t.notEqual(result.value, undefined);
    t.equals(result.value.constructor, Uint8Array);
    t.equals(result.value.buffer.byteLength, 32);
    t.equals(result.value.byteOffset, 0);
    t.equals(result.value.byteLength, 2);
    t.equals(result.value[0], 0x02);
    t.equals(result.value[1], 0x03);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Automatic pull() after start() and read(view)', t => {
  let pullCount = 0;

  const stream = new ReadableStream({
    pull() {
      ++pullCount;
    },
    type: 'bytes'
  }, {
    highWaterMark: 0
  });

  const reader = stream.getReader();
  reader.read(new Uint8Array(8));

  t.equals(pullCount, 0, 'No pull as start() just finished and is not yet reflected to the state of the stream');

  Promise.resolve().then(() => {
    t.equals(pullCount, 1, 'pull must be invoked');

    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then read()', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
      t.equals(c.desiredSize, -8, 'desiredSize after enqueue() in start()');

      controller = c;
    },
    pull() {
      ++pullCount;

      if (pullCount === 1) {
        t.equals(controller.desiredSize, 8, 'desiredSize in pull()');
      }
    },
    type: 'bytes'
  }, {
    highWaterMark: 8
  });

  Promise.resolve().then(() => {
    t.equals(pullCount, 0, 'No pull as the queue was filled by start()');

    const reader = stream.getReader();

    reader.read().then(result => {
      t.equals(result.done, false, 'result.done');

      const view = result.value;
      t.equals(view.constructor, Uint8Array, 'view.constructor');
      t.equals(view.buffer.byteLength, 16, 'view.buffer');
      t.equals(view.byteOffset, 0, 'view.byteOffset');
      t.equals(view.byteLength, 16, 'view.byteLength');

      t.end();
    });

    t.equals(pullCount, 1, 'The first pull() should be made on read()');
  });
});

test('ReadableStream with byte source: Push source that doesn\'t understand pull signal', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 1);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 1);

    t.end();
  });

  controller.enqueue(new Uint8Array(1));
});

test('ReadableStream with byte source: read(), but pull() function is not callable', t => {
  const stream = new ReadableStream({
    pull: 'foo',
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.fail('read() must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: read(view), but pull() function is not callable', t => {
  const stream = new ReadableStream({
    pull: 'foo',
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.fail('read() must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue() with Uint16Array, getReader(), then read()', t => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint16Array(16));
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 32);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 32);

    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), read(view) partially, then read()', t => {
  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(16);
      view[0] = 0x01;
      view[8] = 0x02;
      c.enqueue(view);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const byobReader = stream.getReader({mode: 'byob'});

  byobReader.read(new Uint8Array(8)).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.constructor, Uint8Array, 'value.constructor');
    t.equals(view.buffer.byteLength, 8, 'value.buffer.byteLength');
    t.equals(view.byteOffset, 0, 'value.byteOffset');
    t.equals(view.byteLength, 8, 'value.byteLength');
    t.equals(view[0], 0x01);

    byobReader.releaseLock();

    const reader = stream.getReader();

    return reader.read();
  }).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.constructor, Uint8Array, 'value.constructor');
    t.equals(view.buffer.byteLength, 16, 'value.buffer.byteLength');
    t.equals(view.byteOffset, 8, 'value.byteOffset');
    t.equals(view.byteLength, 8, 'value.byteLength');
    t.equals(view[0], 0x02);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: getReader(), enqueue(), close(), then read()', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  controller.enqueue(new Uint8Array(16));
  controller.close();

  reader.read().then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 16, 'byteLength');

    return reader.read();
  }).then(result => {
    t.equals(result.done, true, 'done');
    t.equals(result.value, undefined, 'value');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), close(), getReader(), then read()', t => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
      c.close();
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 16, 'byteLength');

    return reader.read();
  }).then(result => {
    t.equals(result.done, true, 'done');
    t.equals(result.value, undefined, 'value');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Respond to pull() by enqueue()', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      controller.enqueue(new Uint8Array(16));
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.byteLength, 16, 'byteLength');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Respond to pull() by enqueue() asynchronously', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest is undefined');

      if (pullCount === 0) {
        t.equals(controller.desiredSize, 256, 'desiredSize on pull');

        controller.enqueue(new Uint8Array(1));
        t.equals(controller.desiredSize, 256, 'desiredSize after 1st enqueue()');

        controller.enqueue(new Uint8Array(1));
        t.equals(controller.desiredSize, 256, 'desiredSize after 2nd enqueue()');
      } else {
        t.fail('Too many pull() calls');
        t.end();
        return;
      }

      ++pullCount;
    },
    type: 'bytes'
  }, {
    highWaterMark: 256
  });

  const reader = stream.getReader();

  const p0 = reader.read();
  const p1 = reader.read();
  const p2 = reader.read();

  // Respond to the first pull call.
  controller.enqueue(new Uint8Array(1));

  t.equals(pullCount, 0, 'pullCount after the enqueue() outside pull');

  Promise.all([p0, p1, p2]).then(result => {
    t.equals(pullCount, 1, 'pullCount after completion of all read()s');

    t.equals(result[0].done, false, 'result[0].done');
    t.equals(result[0].value.byteLength, 1, 'result[0].value.byteLength');
    t.equals(result[1].done, false, 'result[1].done');
    t.equals(result[1].value.byteLength, 1, 'result[1].value.byteLength');
    t.equals(result[2].done, false, 'result[2].done');
    t.equals(result[2].value.byteLength, 1, 'result[2].value.byteLength');

    t.end();
  }).catch(e => {
    t.fail('Promise.all() rejected: ' + e);
    t.end();
  });
});

test('ReadableStream with byte source: read(view), then respond()', t => {
  let controller;

  let pullCount = 0;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined before respond()');

        const view = controller.byobRequest.view;
        view[0] = 0x01;
        controller.byobRequest.respond(1);

        t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined after respond()');
      } else {
        t.fail('Too many pull() calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.equals(result.done, false, 'result.done');
    t.equals(result.value.byteLength, 1, 'result.value.byteLength');
    t.equals(result.value[0], 0x01, 'result.value[0]');
    t.end();
  }, e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: read(view), then respond() with a transferred ArrayBuffer', t => {
  let controller;

  let pullCount = 0;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined before respond()');

        // Emulate ArrayBuffer transfer by just creating a new ArrayBuffer and pass it. By checking the result of
        // read(view), we test that the respond()'s buffer argument is working correctly.
        //
        // A real implementation of the underlying byte source would transfer controller.byobRequest.view.buffer into
        // a new ArrayBuffer, then construct a view around it and write to it.
        const transferredView = new Uint8Array(1);
        transferredView[0] = 0x01;
        controller.byobRequest.respondWithNewView(transferredView);

        t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined after respond()');
      } else {
        t.fail('Too many pull() calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.equals(result.done, false, 'result.done');
    t.equals(result.value.byteLength, 1, 'result.value.byteLength');
    t.equals(result.value[0], 0x01, 'result.value[0]');
    t.end();
  }, e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: read(view), then respond() with too big value', t => {
  let controller;

  let pullCount = 0;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        t.notEqual(controller.byobRequest, undefined, 'byobRequest is not undefined');

        try {
          controller.byobRequest.respond(2);
        } catch(e) {
          t.equals(e.constructor, RangeError);

          t.end();
          return;
        }

        t.fail('respond() didn\'t throw');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: respond(3) to read(view) with 2 element Uint16Array enqueues the 1 byte ' +
    'remainder', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount > 1) {
        t.fail('Too many pull calls');
        t.end();
        return;
      }

      ++pullCount;

      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');
      const view = controller.byobRequest.view;

      t.equals(view.constructor, Uint8Array);
      t.equals(view.buffer.byteLength, 4);

      t.equals(view.byteOffset, 0);
      t.equals(view.byteLength, 4);

      view[0] = 0x01;
      view[1] = 0x02;
      view[2] = 0x03;

      controller.byobRequest.respond(3);
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint16Array(2)).then(result => {
    t.equals(pullCount, 1);

    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 2, 'byteLength');

    t.equals(view[0], 0x0201);

    return reader.read(new Uint8Array(1));
  }).then(result => {
    t.equals(pullCount, 1);

    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 1, 'byteLength');

    t.equals(view[0], 0x03);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then read(view)', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 0x01;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest is undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 16);
    t.equals(view[15], 0x01);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then cancel()', t => {
  let cancelCount = 0;

  const passedReason = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    cancel(reason) {
      if (cancelCount === 0) {
        t.equals(reason, passedReason);
      } else {
        t.fail('Too many cancel calls');
        t.end();
        return;
      }

      ++cancelCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.cancel(passedReason).then(result => {
    t.equals(result, undefined);
    t.equals(cancelCount, 1);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then cancel()', t => {
  let cancelCount = 0;

  const passedReason = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    cancel(reason) {
      if (cancelCount === 0) {
        t.equals(reason, passedReason);
      } else {
        t.fail('Too many cancel calls');
        t.end();
        return;
      }

      ++cancelCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.cancel(passedReason).then(result => {
    t.equals(result, undefined);
    t.equals(cancelCount, 1);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: getReader(), read(view), then cancel()', t => {
  let cancelCount = 0;

  const passedReason = new TypeError('foo');

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    cancel(reason) {
      if (cancelCount === 0) {
        t.equals(reason, passedReason);

        controller.byobRequest.respond(0);
      } else {
        t.fail('Too many cancel calls');
        t.end();
        return;
      }

      ++cancelCount;

      return 'bar';
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  const readPromise0 = reader.read(new Uint8Array(1)).then(result => {
    t.equals(result.done, true);
  });

  const readPromise1 = reader.cancel(passedReason).then(result => {
    t.equals(result, undefined);
    t.equals(cancelCount, 1);
  });

  Promise.all([readPromise0, readPromise1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: cancel() with partially filled pending pull() request', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest is undefined');

      if (pullCount === 0) {
        t.equals(controller.byobRequest.view.byteLength, 2, 'byteLength before enqueue()');
        controller.enqueue(new Uint8Array(1));
        t.equals(controller.byobRequest.view.byteLength, 1, 'byteLength after enqueue()');
      } else {
        t.fail('Too many pull calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  Promise.resolve().then(() => {
    t.equals(pullCount, 0, 'No pull() as no read(view) yet');

    const reader = stream.getReader({mode: 'byob'});

    reader.read(new Uint16Array(1)).then(result => {
      t.equals(result.done, true, 'result.done');
      t.equals(result.value.constructor, Uint16Array, 'result.value');
      t.end();
    }).catch(e => {
      t.fail(e);
      t.end();
    });

    t.equals(pullCount, 1, '1 pull() should have been made in response to partial fill by enqueue()');

    reader.cancel();

    // Tell that the buffer given via pull() is returned.
    controller.byobRequest.respond(0);
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then read(view) where view.buffer is not fully ' +
    'covered by view', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(8);
      view[7] = 0x01;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  const buffer = new ArrayBuffer(16);

  reader.read(new Uint8Array(buffer, 8, 8)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 16)
    t.equals(view.byteOffset, 8);
    t.equals(view.byteLength, 8);
    t.equals(view[7], 0x01);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: Multiple enqueue(), getReader(), then read(view)', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      let view;

      view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);

      view = new Uint8Array(8);
      view[7] = 111;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(24)).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 24, 'byteLength');
    t.equals(view[15], 123, 'Contents are set from the first chunk');
    t.equals(view[23], 111, 'Contents are set from the second chunk');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then read(view) with a bigger view', t => {
  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 0x01;
      c.enqueue(view);
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(24)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 16);
    t.equals(view[15], 0x01);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue(), getReader(), then read(view) with a smaller views', t => {
  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(16);
      view[7] = 0x01;
      view[15] = 0x02;
      c.enqueue(view);
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(8)).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 8);
    t.equals(view[7], 0x01);

    return reader.read(new Uint8Array(8));
  }).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 8);
    t.equals(view[7], 0x02);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue() 1 byte, getReader(), then read(view) with Uint16Array', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(1);
      view[0] = 0xff;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      if (controller.byobRequest === undefined) {
        return;
      }

      const view = controller.byobRequest.view;

      t.equals(view.constructor, Uint8Array);
      t.equals(view.buffer.byteLength, 2);

      t.equals(view.byteOffset, 1);
      t.equals(view.byteLength, 1);

      view[0] = 0xaa;
      controller.byobRequest.respond(1);
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint16Array(1)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 2);
    t.equals(view[0], 0xaaff);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: enqueue() 3 byte, getReader(), then read(view) with 2-element Uint16Array',
     t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(3);
      view[0] = 0x01;
      view[2] = 0x02;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');

      if (pullCount === 0) {
        const view = controller.byobRequest.view;

        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 2);
        t.equals(view.byteOffset, 1);
        t.equals(view.byteLength, 1);

        view[0] = 0x03;
        controller.byobRequest.respond(1);

        t.equals(controller.desiredSize, 0, 'desiredSize');
      } else {
        t.fail('Too many pull calls');
        t.end();
        return;
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  // Wait for completion of the start method to be reflected.
  Promise.resolve().then(() => {
    const reader = stream.getReader({mode: 'byob'});

    reader.read(new Uint16Array(2)).then(result => {
      t.equals(result.done, false, 'done');

      const view = result.value;
      t.equals(view.constructor, Uint16Array, 'constructor');
      t.equals(view.buffer.byteLength, 4, 'buffer.byteLength');
      t.equals(view.byteOffset, 0, 'byteOffset');
      t.equals(view.byteLength, 2, 'byteLength');
      t.equals(view[0], 0x0001, 'Contents are set');

      const p = reader.read(new Uint16Array(1));

      t.equals(pullCount, 1);

      return p;
    }).then(result => {
      t.equals(result.done, false, 'done');

      const view = result.value;
      t.equals(view.buffer.byteLength, 2, 'buffer.byteLength');
      t.equals(view.byteOffset, 0, 'byteOffset');
      t.equals(view.byteLength, 2, 'byteLength');
      t.equals(view[0], 0x0302, 'Contents are set');

      t.end();
    }).catch(e => {
      t.fail(e);
      t.end();
    });

    t.equals(pullCount, 0);
  });
});

test('ReadableStream with byte source: read(view) with Uint16Array on close()-d stream with 1 byte enqueue()-d must ' +
    'fail', t => {
  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(1);
      view[0] = 0xff;
      c.enqueue(view);
      c.close();
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint16Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    reader.closed.catch(e => {
      t.equals(e.constructor, TypeError);
      t.end();
    });
  });
});

test('ReadableStream with byte source: A stream must be errored if close()-d before fulfilling read(view) with ' +
     'Uint16Array', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      const view = new Uint8Array(1);
      view[0] = 0xff;
      c.enqueue(view);

      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');

      if (pullCount === 0) {
        const view = controller.byobRequest.view;

        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 2);

        t.equals(view.byteOffset, 1);
        t.equals(view.byteLength, 1);
      } else {
        t.fail('Too many pull calls');
        t.end();
        return;
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint16Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    reader.closed.catch(e => {
      t.equals(e.constructor, TypeError);

      // pull is never called since the startPromise has not yet been handled.
      t.equals(pullCount, 0);

      t.end();
    });
  });

  try {
    controller.close();
  } catch(e) {
    t.equals(e.constructor, TypeError);
    return;
  }

  t.fail('controller.close() didn\'t throw');
  t.end();
});

test('ReadableStream with byte source: Throw if close()-ed more than once', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    type: 'bytes'
  });

  // Enqueue a chunk so that the stream doesn't get closed. This is to check duplicate close() calls are rejected
  // even if the stream has not yet entered the closed state.
  const view = new Uint8Array(1);
  controller.enqueue(view);
  controller.close();

  try {
    controller.close();
  } catch(e) {
    t.equals(e.constructor, TypeError);
    t.end();
    return;
  }

  t.fail('controller.close() didn\'t throw');
  t.end();
});

test('ReadableStream with byte source: Throw on enqueue() after close()', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    type: 'bytes'
  });

  // Enqueue a chunk so that the stream doesn't get closed. This is to check enqueue() after close() is  rejected
  // even if the stream has not yet entered the closed state.
  const view = new Uint8Array(1);
  controller.enqueue(view);
  controller.close();

  try {
    controller.enqueue(view);
  } catch(e) {
    t.equals(e.constructor, TypeError);
    t.end();
    return;
  }

  t.fail('controller.close() didn\'t throw');
  t.end();
});

test('ReadableStream with byte source: read(view), then respond() and close() in pull()', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');
      const view = controller.byobRequest.view;

      t.equals(view.constructor, Uint8Array);
      t.equals(view.buffer.byteLength, 16);

      t.equals(view.byteOffset, 0);
      t.equals(view.byteLength, 16);

      view[15] = 0x01;
      controller.byobRequest.respond(16);
      controller.close();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 16);
    t.equals(view[15], 0x01);

    return reader.read(new Uint8Array(16));
  }).then(result => {
    t.equals(result.done, true);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 0);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: read(view) with Uint32Array, then fill it by multiple respond() calls', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (controller.byobRequest === undefined) {
        return;
      }

      if (pullCount < 1) {
        for (let i = 0; i < 4; ++i) {
          const view = controller.byobRequest.view;

          t.equals(view.constructor, Uint8Array);
          t.equals(view.buffer.byteLength, 4);

          t.equals(view.byteOffset, i);
          t.equals(view.byteLength, 4 - i);

          view[0] = 0x01;
          controller.byobRequest.respond(1);
        }
      } else {
        t.fail('Too many pull() calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint32Array(1)).then(result => {
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 4);
    t.equals(view[0], 0x01010101);

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableStream with byte source: read() twice, then enqueue() twice', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');

      if (pullCount > 1) {
        t.fail('Too many pull calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  const p0 = reader.read().then(result => {
    t.equals(pullCount, 1);

    controller.enqueue(new Uint8Array(2));

    // Since the queue has data no less than HWM, no more pull.
    t.equals(pullCount, 1);

    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 1);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 1);
  });

  t.equals(pullCount, 0, 'No pull should have been made since the startPromise has not yet been handled');

  const p1 = reader.read().then(result => {
    t.equals(pullCount, 1);

    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 2);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 2);
  });

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  })

  t.equals(pullCount, 0, 'No pull should have been made since the startPromise has not yet been handled');

  controller.enqueue(new Uint8Array(1));

  t.equals(pullCount, 0, 'No pull should have been made since the startPromise has not yet been handled');
});

test('ReadableStream with byte source: Multiple read(view), close() and respond()', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');

      if (pullCount === 0) {
        const view = controller.byobRequest.view;

        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 16);

        t.equals(view.byteOffset, 0);
        t.equals(view.byteLength, 16);
      } else {
        t.fail('Too many pull calls');
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  const p0 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, true, '1st read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '1st read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '1st read: byteOffset');
    t.equals(view.byteLength, 0, '1st read: byteLength');
  });

  const p1 = reader.read(new Uint8Array(32)).then(result => {
    t.equals(result.done, true, '2nd read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 32, '2nd read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '2nd read: byteOffset');
    t.equals(view.byteLength, 0, '2nd read: byteLength');
  });

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  })

  controller.close();
  controller.byobRequest.respond(0);
});

test('ReadableStream with byte source: Multiple read(view), big enqueue()', t => {
  let pullCount = 0;

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount === 0) {
        t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');
        const view = controller.byobRequest.view;

        t.equals(view.constructor, Uint8Array);
        t.equals(view.buffer.byteLength, 16);

        t.equals(view.byteOffset, 0);
        t.equals(view.byteLength, 16);
      } else {
        t.fail();
        t.end();
      }

      ++pullCount;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  const p0 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false, '1st read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '1st read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '1st read: byteOffset');
    t.equals(view.byteLength, 16, '1st read: byteLength');
  });

  const p1 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false, '2nd read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '2nd read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '2nd read: byteOffset');
    t.equals(view.byteLength, 8, '2nd read: byteLength');
  });

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  })

  controller.enqueue(new Uint8Array(24));
});

test('ReadableStream with byte source: Multiple read(view) and multiple enqueue()', t => {
  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  let bytesRead = 0;

  const pump = () => {
    reader.read(new Uint8Array(7)).then(result => {
      if (result.done) {
        t.equals(bytesRead, 1024);
        t.end();

        return;
      }

      bytesRead += result.value.byteLength;

      pump();
    }).catch(e => {
      t.fail(e);
      t.end();
    });
  };
  pump();

  controller.enqueue(new Uint8Array(512));
  controller.enqueue(new Uint8Array(512));
  controller.close();
});

test('ReadableStream with byte source: read(view) with passing undefined as view must fail', t => {
  const stream = new ReadableStream({
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read().then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: read(view) with zero-length view must fail', t => {
  const stream = new ReadableStream({
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(0)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: read(view) with passing an empty object as view must fail', t => {
  const stream = new ReadableStream({
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read({}).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }, e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: Even read(view) with passing ArrayBufferView like object as view must fail',
     t => {
  const stream = new ReadableStream({
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read({buffer: new ArrayBuffer(10), byteOffset: 0, byteLength: 10}).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }, e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});

test('ReadableStream with byte source: read() on an errored stream', t => {
  const passedError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.error(passedError);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.fail('read() must fail');
    t.end();
  }, e => {
    t.equals(e, passedError);
    t.end();
  });
});

test('ReadableStream with byte source: read(), then error()', t => {
  const passedError = new TypeError('foo');

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.fail('read() must fail');
    t.end();
  }, e => {
    t.equals(e, passedError);
    t.end();
  });

  controller.error(passedError);
});

test('ReadableStream with byte source: read(view) on an errored stream', t => {
  const passedError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      c.error(passedError);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }, e => {
    t.equals(e, passedError);
    t.end();
  });
});

test('ReadableStream with byte source: read(view), then error()', t => {
  const passedError = new TypeError('foo');

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }, e => {
    t.equals(e, passedError);
    t.end();
  });

  controller.error(passedError);
});

test('ReadableStream with byte source: Throwing in pull function must error the stream', t => {
  let controller;

  const testError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
      throw testError;
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e, testError);
    reader.closed.catch(e => {
      t.equals(e, testError);
      t.end();
    });
  });
});

test('ReadableStream with byte source: Throwing in pull in response to read() must be ignored if the stream is ' +
    'errored in it', t => {
  const passedError = new TypeError('foo');

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.equals(controller.byobRequest, undefined, 'byobRequest must be undefined');
      controller.error(passedError);
      throw new TypeError('foo');
    },
    type: 'bytes'
  });

  const reader = stream.getReader();

  reader.read().then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e, passedError);
    reader.closed.catch(e => {
      t.equals(e, passedError);
      t.end();
    });
  });
});

test('ReadableStream with byte source: Throwing in pull in response to read(view) function must error the stream',
     t => {
  let controller;

  const testError = new TypeError('foo');

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');
      throw testError;
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e, testError);
    reader.closed.catch(e => {
      t.equals(e, testError);
      t.end();
    });
  });
});

test('ReadableStream with byte source: Throwing in pull in response to read(view) must be ignored if the stream is ' +
    'errored in it', t => {
  const passedError = new TypeError('foo');

  let controller;

  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.notEqual(controller.byobRequest, undefined, 'byobRequest must not be undefined');
      controller.error(passedError);
      throw new TypeError('foo');
    },
    type: 'bytes'
  });

  const reader = stream.getReader({mode: 'byob'});

  reader.read(new Uint8Array(1)).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e, passedError);
    reader.closed.catch(e => {
      t.equals(e, passedError);
      t.end();
    });
  });
});
