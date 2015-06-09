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

  reader.read().then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.constructor, Uint8Array, 'value.constructor');
    t.equals(result.value.buffer.byteLength, 16, 'value.buffer.byteLength');
    t.equals(result.value.byteOffset, 0, 'value.byteOffset');
    t.equals(result.value.byteLength, 16, 'value.byteLength');

    t.end();
  });
});

test('ReadableByteStream: enqueue(), getReader(), then read()', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      c.enqueue(new Uint16Array(16));
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

  reader.read().then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.constructor, Uint8Array, 'value.constructor');
    t.equals(result.value.buffer.byteLength, 32, 'value.buffer.byteLength');
    t.equals(result.value.byteOffset, 0, 'value.byteOffset');
    t.equals(result.value.byteLength, 32, 'value.byteLength');

    t.end();
  });
});

test('ReadableByteStream: enqueue(), read(view) partially, then read()', t => {
  const rbs = new ReadableByteStream({
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
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const byobReader = rbs.getByobReader();

  byobReader.read(new Uint8Array(8)).then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.constructor, Uint8Array, 'value.constructor');
    t.equals(result.value.buffer.byteLength, 8, 'value.buffer.byteLength');
    t.equals(result.value.byteOffset, 0, 'value.byteOffset');
    t.equals(result.value.byteLength, 8, 'value.byteLength');
    t.equals(result.value[0], 0x01);

    byobReader.releaseLock();

    const reader = rbs.getReader();
    return reader.read();
  }).then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.constructor, Uint8Array, 'value.constructor');
    t.equals(result.value.buffer.byteLength, 16, 'value.buffer.byteLength');
    t.equals(result.value.byteOffset, 8, 'value.byteOffset');
    t.equals(result.value.byteLength, 8, 'value.byteLength');
    t.equals(result.value[0], 0x02);

    t.end();
  }).catch(e => {
    throw e;
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

  reader.read().then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');

    return reader.read();
  }).then(result => {
    t.equals(result.done, true, 'done is true');
    t.equals(result.value, undefined, 'value is undefined');

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

  reader.read().then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');

    return reader.read();
  }).then(result => {
    t.equals(result.done, true, 'done is true');
    t.equals(result.value, undefined, 'value is undefined');

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

  reader.read().then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');

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

  reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');
    t.equals(result.value[15], 123, 'Contents are set');
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

  reader.read(new Uint8Array(24)).then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 24, 'byteLength is 0');
    t.equals(result.value[15], 123, 'Contents are set from the first chunk');
    t.equals(result.value[23], 111, 'Contents are set from the second chunk');

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

  reader.read(new Uint8Array(24)).then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');
    t.equals(result.value[15], 123, 'Contents are set from the chunk by start()');

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
      t.fail('pull must not be called');
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

  reader.read(new Uint16Array(1)).then(result => {
    t.equals(result.done, false, 'done is false');
    t.equals(result.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(result.value.byteLength, 2, 'byteLength is 24');
    t.equals(result.value[0], 0xaaff, 'Contents are set');

    t.end();
  }).catch(e => {
    throw e;
  });
});

test('ReadableByteStream: enqueue() 3 byte, getReader(), then read(view) with 2-element Uint16Array', t => {
  let pullIntoCount = 0;

  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(3);
      view[0] = 0x01;
      view[2] = 0x02;
      c.enqueue(view);
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
      t.end();
    },
    pullInto(buffer, offset, length) {
      if (pullIntoCount === 0) {
        t.equals(buffer.constructor, ArrayBuffer, 'buffer is ArrayBuffer');
        t.equals(buffer.byteLength, 2, 'byteLength');
        t.equals(offset, 1, 'offset');
        t.equals(length, 1, 'length');
        (new Uint8Array(buffer, 1, 1))[0] = 0x03;
        controller.respond(1);
      } else {
        t.fail('Too many pullInto call');
        t.end();
      }
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint16Array(2)).then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.constructor, Uint16Array, 'constructor');
    t.equals(result.value.buffer.byteLength, 4, 'buffer.byteLength' + result.value.buffer.byteLength);
    t.equals(result.value.byteOffset, 0, 'byteOffset');
    t.equals(result.value.byteLength, 2, 'byteLength');
    t.equals(result.value[0], 0x0001, 'Contents are set');

    return reader.read(new Uint16Array(1));
  }).then(result => {
    t.equals(result.done, false, 'done');
    t.equals(result.value.buffer.byteLength, 2, 'buffer.byteLength');
    t.equals(result.value.byteOffset, 0, 'byteOffset');
    t.equals(result.value.byteLength, 2, 'byteLength');
    t.equals(result.value[0], 0x0302, 'Contents are set');

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
      t.fail('pull must not be called');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getByobReader();

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

test('ReadableByteStream: read(view), respond() in pullInto(), then enqueue()', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
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

test('ReadableByteStream: Multiple read(view), close() and respond()', t => {
  let count = 0;

  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
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

test('ReadableByteStream: Multiple read(view), big enqueue()', t => {
  let count = 0;

  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail('pull must not be called');
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
    throw e;
  })

  controller.enqueue(new Uint8Array(24));
});
