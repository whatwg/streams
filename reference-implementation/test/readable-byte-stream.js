const test = require('tape-catch');

test('ReadableByteStream can be constructed with no errors', t => {
  new ReadableByteStream();

  t.doesNotThrow(() => new ReadableByteStream(), 'ReadableByteStream constructed with no parameters');
  t.doesNotThrow(() => new ReadableByteStream({ }),
                 'ReadableByteStream constructed with an empty object as parameter');
  t.doesNotThrow(() => new ReadableByteStream(undefined),
                 'ReadableByteStream constructed with undefined as parameter');
  let x;
  t.doesNotThrow(() => new ReadableByteStream(x),
                 'ReadableByteStream constructed with an undefined variable as parameter');
  t.end();
});

test('ReadableByteStream: enqueue(), getReader(), then read()', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');
    t.end();
  });
});

test('ReadableByteStream: getReader(), enqueue(), close(), then read()', t => {
  let controller;

  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  controller.enqueue(new Uint8Array(16));
  controller.close();

  reader.read().then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');

    return reader.read();
  }).then(view => {
    t.equals(view.done, true, 'done is true');
    t.equals(view.value, undefined, 'value is undefined');

    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue(), close(), getReader(), then read()', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
      c.close();
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');

    return reader.read();
  }).then(view => {
    t.equals(view.done, true, 'done is true');
    t.equals(view.value, undefined, 'value is undefined');

    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: read(), then enqueue()', t => {
  let controller;

  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      controller.enqueue(new Uint8Array(16));
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');

    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue(), getReader(), then read(view)', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(16)).then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');
    t.equals(view.value[15], 123, 'Contents are set');
    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: Multiple enqueue(), getReader(), then read(view)', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      let view;

      view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);

      view = new Uint8Array(8);
      view[7] = 111;
      c.enqueue(view);
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(24)).then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 24, 'byteLength is 0');
    t.equals(view.value[15], 123, 'Contents are set from the first chunk');
    t.equals(view.value[23], 111, 'Contents are set from the second chunk');
    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue(), getReader(), then read(view) with a bigger view', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(24)).then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');
    t.equals(view.value[15], 123, 'Contents are set from the chunk by start()');
    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue() 1 byte, getReader(), then read(view) with Uint16Array', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(1);
      view[0] = 0xff;
      c.enqueue(view);
      controller = c;
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(buffer, offset, length) {
      t.equals(buffer.constructor, ArrayBuffer, 'buffer is ArrayBuffer');
      t.equals(buffer.byteLength, 2, 'byteLength is 2');
      t.equals(offset, 1, 'offset is 1');
      t.equals(length, 1, 'length is 1');
      (new Uint8Array(buffer))[1] = 0xaa;
      controller.respond(1);
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint16Array(1)).then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 2, 'byteLength is 24');
    t.equals(view.value[0], 0xaaff, 'Contents are set');
    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue() 1 byte, close(), getReader(), then read(view) with Uint16Array', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(1);
      view[0] = 0xff;
      c.enqueue(view);
      c.close();
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(buffer, offset, length) {
      t.fail();
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint16Array(1)).then(view => {
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

test('ReadableByteStream: read(view), respond() in pullInto(), then enqueue()', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(buffer, offset, length) {
      t.equals(buffer.constructor, ArrayBuffer, 'buffer is ArrayBuffer');
      t.equals(buffer.byteLength, 16, 'byteLength is 16');
      t.equals(offset, 0, 'offset is 0');
      t.equals(length, 16, 'length is 16');
      (new Uint8Array(buffer))[15] = 123;
      controller.respond(16);
      controller.close();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0: ' + result.value.byteOffset);
    t.equals(result.value.byteLength, 16, 'byteLength is 16: ' + result.value.byteLength);
    t.equals(result.value[15], 123, 'Contents are set');

    return reader.read(new Uint8Array(16));
  }).then(result => {
    t.equals(result.done, true, 'done is true');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');
    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: Multiple read(view), close() and respond() in pullInto()', t => {
  let count = 0;

  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(buffer, offset, length) {
      if (count === 0) {
        t.equals(buffer.constructor, ArrayBuffer, 'buffer is ArrayBuffer');
        t.equals(buffer.byteLength, 16, 'byteLength is 16');
        t.equals(offset, 0, 'offset is 0');
        t.equals(length, 16, 'length is 16');
      } else {
        t.fail();
        t.end();
      }

      ++count;
    }
  });

  const reader = rbs.getByobReader();

  const p0 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, true, '1st read: done is true');
    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '1st read: buffer.byteLength is 16');
    t.equals(view.byteOffset, 0, '1st read: byteOffset is 0');
    t.equals(view.byteLength, 0, '1st read: byteLength is 0');
  });

  const p1 = reader.read(new Uint8Array(32)).then(result => {
    t.equals(result.done, true, '2nd read: done is true');
    const view = result.value;
    t.equals(view.buffer.byteLength, 32, '2nd read: buffer.byteLength is 32');
    t.equals(view.byteOffset, 0, '2nd read: byteOffset is 0');
    t.equals(view.byteLength, 0, '2nd read: byteLength is 0');
  });

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    throw e;
  })

  controller.close();
  controller.respond(0);
});
