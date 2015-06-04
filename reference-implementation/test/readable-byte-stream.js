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

test('ReadableByteStream: enqueue(), then read()', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto() {
      t.fail();
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
      t.fail();
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteLength, 16, 'byteLength is 16');
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: enqueue(), then read(view)', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto() {
      t.fail();
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
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: Multiple enqueue(), then read(view)', t => {
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
      t.fail();
      t.end();
    },
    pullInto() {
      t.fail();
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
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: enqueue(), then read(view) with a bigger view', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 123;
      c.enqueue(view);
      controller = c;
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(buffer, offset, length) {
      t.equals(buffer.constructor, ArrayBuffer, 'buffer is ArrayBuffer');
      t.equals(buffer.byteLength, 24, 'byteLength is 24');
      t.equals(offset, 16, 'offset is 16');
      t.equals(length, 8, 'length is 8');
      (new Uint8Array(buffer))[23] = 111;
      controller.respond(8);
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(24)).then(view => {
    t.equals(view.done, false, 'done is false');
    t.equals(view.value.byteOffset, 0, 'byteOffset is 0');
    t.equals(view.value.byteLength, 24, 'byteLength is 24');
    t.equals(view.value[15], 123, 'Contents are set from the chunk by start()');
    t.equals(view.value[23], 111, 'Contents are set from the chunk by pullInto()');
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: enqueue() 1 byte, then read(view) with Uint16Array', t => {
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
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: read(), then enqueue()', t => {
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
    t.equals(result.value.byteLength, 16, 'byteLength is 16');
    t.equals(result.value[15], 123, 'Contents are set');

    return reader.read(new Uint8Array(16));
  }).then(result => {
    t.equals(result.done, true, 'done is true');
    t.equals(result.value.byteLength, 16, 'byteLength is 16');
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});
