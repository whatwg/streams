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

test('enqueue and read from ReadableByteStream', t => {
  const rbs = new ReadableByteStream({
    start(c) {
      c.enqueue(new Uint8Array(16));
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(view) {
      t.fail();
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false);
    t.equals(view.value.byteLength, 16);
    t.end();
  });
});

test('read and enqueue from ReadableByteStream', t => {
  let controller;

  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      controller.enqueue(new Uint8Array(16));
    },
    pullInto(view) {
      t.fail();
      t.end();
    }
  });

  const reader = rbs.getReader();

  reader.read().then(view => {
    t.equals(view.done, false);
    t.equals(view.value.byteLength, 16);
    t.end();
  });
});

test('enqueue and readInto from ReadableByteStream', t => {
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
    pullInto(view) {
      t.fail();
      t.end();
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(16)).then(view => {
    t.equals(view.done, false);
    t.equals(view.value.byteLength, 16);
    t.equals(view.value[15], 123);
    t.end();
  });
});

test.only('readInto and enqueue from ReadableByteStream', t => {
  let controller;
  const rbs = new ReadableByteStream({
    start(c) {
      controller = c;
    },
    pull() {
      t.fail();
      t.end();
    },
    pullInto(view) {
      view[15] = 123;
      controller.respond(view);
    }
  });

  const reader = rbs.getByobReader();

  reader.read(new Uint8Array(16)).then(view => {
    t.equals(view.done, false);
    t.equals(view.value.byteLength, 16);
    t.equals(view.value[15], 123);
    t.end();
  });
});
