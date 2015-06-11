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

test('ReadableByteStream: getReader(), then releaseLock()', t => {
  const rbs = new ReadableByteStream({
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
  reader.releaseLock();

  t.end();
});

test('ReadableByteStream: getReader(), read(), then releaseLock()', t => {
  let pullCount = 0;

  const rbs = new ReadableByteStream({
    pull() {
      ++pullCount;
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();
  reader.read();
  try {
    reader.releaseLock();
  } catch(e) {
    t.equals(e.constructor, TypeError);

    t.equals(pullCount, 1);

    t.end();

    return;
  }

  t.fail('reader.releaseLock() didn\'t throw');
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
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 16);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 16);

    t.end();
  });
});

test('ReadableByteStream: enqueue() with Uint16Array, getReader(), then read()', t => {
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
    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 32);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 32);

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

    const view = result.value;
    t.equals(view.constructor, Uint8Array, 'value.constructor');
    t.equals(view.buffer.byteLength, 8, 'value.buffer.byteLength');
    t.equals(view.byteOffset, 0, 'value.byteOffset');
    t.equals(view.byteLength, 8, 'value.byteLength');
    t.equals(view[0], 0x01);

    byobReader.releaseLock();

    const reader = rbs.getReader();

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
    t.equals(result.done, false, 'done');
    t.equals(result.value.byteLength, 16, 'byteLength');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: read(), then respond()', t => {
  let controller;

  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      try {
        controller.respond(1);
      } catch(e) {
        t.equals(e.constructor, TypeError);

        t.end();
        return;
      }

      t.fail('respond() didn\'t throw');
      t.end();
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: read(view), then respond() with too big value', t => {
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
      try {
        controller.respond(2);
      } catch(e) {
        t.equals(e.constructor, RangeError);

        t.end();
        return;
      }

      t.fail('respond() didn\'t throw');
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(1)).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('ReadableByteStream: enqueue(), getReader(), then read(view)', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 0x01;
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

test('ReadableByteStream: enqueue(), getReader(), then read(view) where view.buffer is not fully covered by view', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(8);
      view[7] = 0x01;
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

test('ReadableByteStream: enqueue(), getReader(), then read(view) with a bigger view', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[15] = 0x01;
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

test('ReadableByteStream: enqueue(), getReader(), then read(view) with a smaller views', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      const view = new Uint8Array(16);
      view[7] = 0x01;
      view[15] = 0x02;
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
      t.equals(buffer.constructor, ArrayBuffer);
      t.equals(buffer.byteLength, 2);

      t.equals(offset, 1);
      t.equals(length, 1);

      (new Uint8Array(buffer))[1] = 0xaa;
      controller.respond(1);
    }
  });

  const reader = rbs.getByobReader();

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
        t.equals(buffer.constructor, ArrayBuffer);
        t.equals(buffer.byteLength, 2);
        t.equals(offset, 1);
        t.equals(length, 1);

        (new Uint8Array(buffer, 1, 1))[0] = 0x03;
        controller.respond(1);
      } else {
        t.fail('Too many pullInto calls');
        t.end();
      }

      ++pullIntoCount;
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint16Array(2)).then(result => {
    t.equals(result.done, false, 'done');

    const view = result.value;
    t.equals(view.constructor, Uint16Array, 'constructor');
    t.equals(view.buffer.byteLength, 4, 'buffer.byteLength');
    t.equals(view.byteOffset, 0, 'byteOffset');
    t.equals(view.byteLength, 2, 'byteLength');
    t.equals(view[0], 0x0001, 'Contents are set');

    const p = reader.read(new Uint16Array(1));

    t.equals(pullIntoCount, 1);

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

  t.equals(pullIntoCount, 0);
});

test('ReadableByteStream: enqueue() 1 byte, close(), getReader(), then read(view) with Uint16Array', t => {
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

test('ReadableByteStream: enqueue() 1 byte, read(view) with Uint16Array, then close()', t => {
  let pullIntoCount = 0;

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
      if (pullIntoCount === 0) {
        t.equals(buffer.constructor, ArrayBuffer);
        t.equals(buffer.byteLength, 2);

        t.equals(offset, 1);
        t.equals(length, 1);
      } else {
        t.fail('Too many pullInto calls');
        t.end();
        return;
      }

      ++pullIntoCount;
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

      t.equals(pullIntoCount, 1);

      t.end();
    });
  });

  t.equals(pullIntoCount, 1);

  try {
    controller.close();
  } catch(e) {
    t.equals(e.constructor, TypeError);
    return;
  }

  t.fail('controller.close() didn\'t throw');
  t.end();
});

test('ReadableByteStream: read(view), then respond() and close() in pullInto()', t => {
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
      t.equals(buffer.constructor, ArrayBuffer);
      t.equals(buffer.byteLength, 16);

      t.equals(offset, 0);
      t.equals(length, 16);

      (new Uint8Array(buffer))[15] = 0x01;
      controller.respond(16);
      controller.close();
    }
  });

  const reader = rbs.getByobReader();

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

test('ReadableByteStream: read(view) with Uint32Array, then fill it by multiple respond() calls', t => {
  let pullIntoCount = 0;

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
      if (pullIntoCount < 4) {
        t.equals(buffer.constructor, ArrayBuffer);
        t.equals(buffer.byteLength, 4);

        t.equals(offset, pullIntoCount);
        t.equals(length, 4 - pullIntoCount);

        (new Uint8Array(buffer, offset, length))[0] = 0x01;
        controller.respond(1);
      } else {
        t.fail('Too many pullInto() calls');
        t.end();
      }

      ++pullIntoCount;
    }
  });

  const reader = rbs.getByobReader();

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

test('ReadableByteStream: read() twice, then enqueue() twice', t => {
  let pullCount = 0;

  let controller;

  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      if (pullCount > 1) {
        t.fail('Too many pullInto calls');
        t.end();
      }

      ++pullCount;
    },
    pullInto() {
      t.fail('pullInto must not be called');
      t.end();
    }
  });

  const reader = rbs.getReader();

  const p0 = reader.read().then(result => {
    t.equals(pullCount, 1);

    controller.enqueue(new Uint8Array(2));

    t.equals(pullCount, 1);

    t.equals(result.done, false);

    const view = result.value;
    t.equals(view.constructor, Uint8Array);
    t.equals(view.buffer.byteLength, 1);
    t.equals(view.byteOffset, 0);
    t.equals(view.byteLength, 1);
  });

  t.equals(pullCount, 1);

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

  t.equals(pullCount, 1);

  controller.enqueue(new Uint8Array(1));

  t.equals(pullCount, 1);
});

test('ReadableByteStream: Multiple read(view), close() and respond()', t => {
  let pullIntoCount = 0;

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
      if (pullIntoCount === 0) {
        t.equals(buffer.constructor, ArrayBuffer);
        t.equals(buffer.byteLength, 16);

        t.equals(offset, 0);
        t.equals(length, 16);
      } else {
        t.fail('Too many pullInto calls');
        t.end();
      }

      ++pullIntoCount;
    }
  });

  const reader = rbs.getByobReader();

  const p0 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, true, '1st read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '1st read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '1st read: byteOffset');
    t.equals(view.byteLength, 0, '1st read: byteLength');
  });

  t.equals(pullIntoCount, 1);

  const p1 = reader.read(new Uint8Array(32)).then(result => {
    t.equals(result.done, true, '2nd read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 32, '2nd read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '2nd read: byteOffset');
    t.equals(view.byteLength, 0, '2nd read: byteLength');
  });

  t.equals(pullIntoCount, 1);

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  })

  controller.close();
  controller.respond(0);
});

test('ReadableByteStream: Multiple read(view), big enqueue()', t => {
  let pullIntoCount = 0;

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
      if (pullIntoCount === 0) {
        t.equals(buffer.constructor, ArrayBuffer);
        t.equals(buffer.byteLength, 16);

        t.equals(offset, 0);
        t.equals(length, 16);
      } else {
        t.fail();
        t.end();
      }

      ++pullIntoCount;
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

  t.equals(pullIntoCount, 1);

  const p1 = reader.read(new Uint8Array(16)).then(result => {
    t.equals(result.done, false, '2nd read: done');

    const view = result.value;
    t.equals(view.buffer.byteLength, 16, '2nd read: buffer.byteLength');
    t.equals(view.byteOffset, 0, '2nd read: byteOffset');
    t.equals(view.byteLength, 8, '2nd read: byteLength');
  });

  t.equals(pullIntoCount, 1);

  Promise.all([p0, p1]).then(() => {
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  })

  controller.enqueue(new Uint8Array(24));

  t.equals(pullIntoCount, 1);
});

test('ReadableByteStream: Multiple read(view) and multiple enqueue()', t => {
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
    }
  });

  const reader = rbs.getByobReader();

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

test('ReadableByteStream: read(view) with unexpected view ', t => {
  const rbs = new ReadableByteStream({
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

  reader.read({}).then(result => {
    t.fail('read(view) must fail');
    t.end();
  }).catch(e => {
    t.equals(e.constructor, TypeError);
    t.end();
  });
});
