const test = require('tape-catch');

test('Can construct a CountQueuingStrategy with a valid high water mark', t => {
  const strategy = new CountQueuingStrategy({ highWaterMark: 4 });

  t.end();
});

test('Can construct a CountQueuingStrategy with any value as its high water mark', t => {
  for (const highWaterMark of [-Infinity, NaN, 'foo', {}, function () {}]) {
    const strategy = new CountQueuingStrategy({ highWaterMark });
    t.ok(Object.is(strategy.highWaterMark, highWaterMark), `${highWaterMark} gets set correctly`);
  }

  t.end();
});

test('CountQueuingStrategy constructor behaves as expected with wrong arguments', t => {
  const highWaterMark = 1;
  const highWaterMarkObjectGetter = {
    get highWaterMark() { return highWaterMark; },
  };
  const error = new Error("wow!");
  const highWaterMarkObjectGetterThrowing = {
    get highWaterMark() { throw error; },
  };
  t.throws(() => new CountQueuingStrategy(), /TypeError/, 'construction fails with undefined');
  t.throws(() => new CountQueuingStrategy(null), /TypeError/, 'construction fails with null');
  t.doesNotThrow(() => new CountQueuingStrategy('potato'), 'construction succeeds with a random non-object type');
  t.doesNotThrow(() => new CountQueuingStrategy({}), 'construction succeeds with an object without hwm property');
  t.doesNotThrow(() => new CountQueuingStrategy(highWaterMarkObjectGetter), 'construction succeeds with an object with a hwm getter');
  t.throws(() => new CountQueuingStrategy(highWaterMarkObjectGetterThrowing), /wow/, 'construction fails with the error thrown by the getter');

  t.end();
});

test('CountQueuingStrategy size behaves as expected with wrong arguments', t => {
  const size = 1024;
  const chunk = { byteLength: size };
  const chunkGetter = {
    get byteLength() { return size; },
  }
  const error = new Error("wow!");
  const chunkGetterThrowing = {
    get byteLength() { throw error; },
  }
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size(), 'size succeeds with undefined');
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size(null), 'size succeeds with null');
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size('potato'), 'size succeeds with a random non-object type');
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size({}), 'size succeeds with an object without hwm property');
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size(chunkGetter), 'size succeeds with an object with a hwm getter');
  t.doesNotThrow(() => CountQueuingStrategy.prototype.size(chunkGetterThrowing), 'size succeeds with a throwing the getter');

  t.end();
});

test('CountQueuingStrategy instances have the correct properties', t => {
  const strategy = new CountQueuingStrategy({ highWaterMark: 4 });

  t.deepEqual(Object.getOwnPropertyDescriptor(strategy, 'highWaterMark'),
    { value: 4, writable: true, enumerable: true, configurable: true },
    'highWaterMark property should be a data property with the value passed the connstructor');
  t.equal(typeof strategy.size, 'function');

  t.end();
});

test('Can construct a readable stream with a valid CountQueuingStrategy', t => {
  t.doesNotThrow(() => new ReadableStream({}, new CountQueuingStrategy({ highWaterMark: 4 })));

  t.end();
});

test('Correctly governs a ReadableStreamController\'s desiredSize property (HWM = 0)', t => {
  let controller;
  const rs = new ReadableStream(
    {
      start(c) {
        controller = c;
      }
    },
    new CountQueuingStrategy({ highWaterMark: 0 })
  );
  const reader = rs.getReader();

  t.equal(controller.desiredSize, 0, '0 reads, 0 enqueues: desiredSize should be 0');
  controller.enqueue('a');
  t.equal(controller.desiredSize, -1, '0 reads, 1 enqueue: desiredSize should be -1');
  controller.enqueue('b');
  t.equal(controller.desiredSize, -2, '0 reads, 2 enqueues: desiredSize should be -2');
  controller.enqueue('c');
  t.equal(controller.desiredSize, -3, '0 reads, 3 enqueues: desiredSize should be -3');
  controller.enqueue('d');
  t.equal(controller.desiredSize, -4, '0 reads, 4 enqueues: desiredSize should be -4');

  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      '1st read gives back the 1st chunk enqueued (queue now contains 3 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'b', done: false },
      '2nd read gives back the 2nd chunk enqueued (queue now contains 2 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'c', done: false },
      '3rd read gives back the 3rd chunk enqueued (queue now contains 1 chunk)');

    t.equal(controller.desiredSize, -1, '3 reads, 4 enqueues: desiredSize should be -1');
    controller.enqueue('e');
    t.equal(controller.desiredSize, -2, '3 reads, 5 enqueues: desiredSize should be -2');

    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'd', done: false },
      '4th read gives back the 4th chunk enqueued (queue now contains 1 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'e', done: false },
      '5th read gives back the 5th chunk enqueued (queue now contains 0 chunks)');

    t.equal(controller.desiredSize, 0, '5 reads, 5 enqueues: desiredSize should be 0');
    controller.enqueue('f');
    t.equal(controller.desiredSize, -1, '5 reads, 6 enqueues: desiredSize should be -1');
    controller.enqueue('g');
    t.equal(controller.desiredSize, -2, '5 reads, 7 enqueues: desiredSize should be -2');

    t.end();
  })
  .catch(e => t.error(e));
});

test('Correctly governs a ReadableStreamController\'s desiredSize property (HWM = 1)', t => {
  let controller;
  const rs = new ReadableStream(
    {
      start(c) {
        controller = c;
      },
    },
    new CountQueuingStrategy({ highWaterMark: 1 })
  );
  const reader = rs.getReader();

  t.equal(controller.desiredSize, 1, '0 reads, 0 enqueues: desiredSize should be 1');
  controller.enqueue('a');
  t.equal(controller.desiredSize, 0, '0 reads, 1 enqueue: desiredSize should be 0');
  controller.enqueue('b');
  t.equal(controller.desiredSize, -1, '0 reads, 2 enqueues: desiredSize should be -1');
  controller.enqueue('c');
  t.equal(controller.desiredSize, -2, '0 reads, 3 enqueues: desiredSize should be -2');
  controller.enqueue('d');
  t.equal(controller.desiredSize, -3, '0 reads, 4 enqueues: desiredSize should be -3');

  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      '1st read gives back the 1st chunk enqueued (queue now contains 3 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'b', done: false },
      '2nd read gives back the 2nd chunk enqueued (queue now contains 2 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'c', done: false },
      '3rd read gives back the 3rd chunk enqueued (queue now contains 1 chunk)');

    t.equal(controller.desiredSize, 0, '3 reads, 4 enqueues: desiredSize should be 0');
    controller.enqueue('e');
    t.equal(controller.desiredSize, -1, '3 reads, 5 enqueues: desiredSize should be -1');

    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'd', done: false },
      '4th read gives back the 4th chunk enqueued (queue now contains 1 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'e', done: false },
      '5th read gives back the 5th chunk enqueued (queue now contains 0 chunks)');

    t.equal(controller.desiredSize, 1, '5 reads, 5 enqueues: desiredSize should be 1');
    controller.enqueue('f');
    t.equal(controller.desiredSize, 0, '5 reads, 6 enqueues: desiredSize should be 0');
    controller.enqueue('g');
    t.equal(controller.desiredSize, -1, '5 reads, 7 enqueues: desiredSize should be -1');

    t.end();
  })
  .catch(e => t.error(e));
});

test('Correctly governs a ReadableStreamController\'s desiredSize property (HWM = 4)', t => {
  let controller;
  const rs = new ReadableStream(
    {
      start(c) {
        controller = c;
      }
    },
    new CountQueuingStrategy({ highWaterMark: 4 })
  );
  const reader = rs.getReader();

  t.equal(controller.desiredSize, 4, '0 reads, 0 enqueues: desiredSize should be 4');
  controller.enqueue('a');
  t.equal(controller.desiredSize, 3, '0 reads, 1 enqueue: desiredSize should be 3');
  controller.enqueue('b');
  t.equal(controller.desiredSize, 2, '0 reads, 2 enqueues: desiredSize should be 2');
  controller.enqueue('c');
  t.equal(controller.desiredSize, 1, '0 reads, 3 enqueues: desiredSize should be 1');
  controller.enqueue('d');
  t.equal(controller.desiredSize, 0, '0 reads, 4 enqueues: desiredSize should be 0');
  controller.enqueue('e');
  t.equal(controller.desiredSize, -1, '0 reads, 5 enqueues: desiredSize should be -1');
  controller.enqueue('f');
  t.equal(controller.desiredSize, -2, '0 reads, 6 enqueues: desiredSize should be -2');


  reader.read().then(result => {
    t.deepEqual(result, { value: 'a', done: false },
      '1st read gives back the 1st chunk enqueued (queue now contains 5 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'b', done: false },
      '2nd read gives back the 2nd chunk enqueued (queue now contains 4 chunks)');

    t.equal(controller.desiredSize, 0, '2 reads, 6 enqueues: desiredSize should be 0');
    controller.enqueue('g');
    t.equal(controller.desiredSize, -1, '2 reads, 7 enqueues: desiredSize should be -1');

    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'c', done: false },
      '3rd read gives back the 3rd chunk enqueued (queue now contains 4 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'd', done: false },
      '4th read gives back the 4th chunk enqueued (queue now contains 3 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'e', done: false },
      '5th read gives back the 5th chunk enqueued (queue now contains 2 chunks)');
    return reader.read();
  })
  .then(result => {
    t.deepEqual(result, { value: 'f', done: false },
      '6th read gives back the 6th chunk enqueued (queue now contains 0 chunks)');

    t.equal(controller.desiredSize, 3, '6 reads, 7 enqueues: desiredSize should be 3');
    controller.enqueue('h');
    t.equal(controller.desiredSize, 2, '6 reads, 8 enqueues: desiredSize should be 2');
    controller.enqueue('i');
    t.equal(controller.desiredSize, 1, '6 reads, 9 enqueues: desiredSize should be 1');
    controller.enqueue('j');
    t.equal(controller.desiredSize, 0, '6 reads, 10 enqueues: desiredSize should be 0');
    controller.enqueue('k');
    t.equal(controller.desiredSize, -1, '6 reads, 11 enqueues: desiredSize should be -1');

    t.end();
  })
  .catch(e => t.error(e));
});

test('Can construct a writable stream with a valid CountQueuingStrategy', t => {
  t.doesNotThrow(() => new WritableStream({}, new CountQueuingStrategy({ highWaterMark: 4 })));

  t.end();
});

test('Correctly governs the value of a WritableStream\'s state property (HWM = 0)', t => {
  const dones = Object.create(null);

  const ws = new WritableStream(
    {
      write(chunk) {
        return new Promise(resolve => dones[chunk] = resolve);
      }
    },
    new CountQueuingStrategy({ highWaterMark: 0 })
  );

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseA = ws.write('a');
    t.equal(ws.state, 'waiting', 'After 1 write, 0 of which finished, state should be \'waiting\'');

    const writePromiseB = ws.write('b');
    t.equal(ws.state, 'waiting', 'After 2 writes, 0 of which finished, state should be \'waiting\'');

    dones.a();
    writePromiseA.then(() => {
      t.equal(ws.state, 'waiting', 'After 2 writes, 1 of which finished, state should be \'waiting\'');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(ws.state, 'writable', 'After 2 writes, 2 of which finished, state should be \'writable\'');

        const writePromiseC = ws.write('c');
        t.equal(ws.state, 'waiting', 'After 3 writes, 2 of which finished, state should be \'waiting\'');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(ws.state, 'writable', 'After 3 writes, 3 of which finished, state should be \'writable\'');

          t.end();
        });
      });
    })
    .catch(t.error);
  }, 0);
});

test('Correctly governs the value of a WritableStream\'s state property (HWM = 4)', t => {
  const dones = Object.create(null);

  const ws = new WritableStream(
    {
      write(chunk) {
        return new Promise(resolve => dones[chunk] = resolve);
      }
    },
    new CountQueuingStrategy({ highWaterMark: 4 })
  );

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseA = ws.write('a');
    t.equal(ws.state, 'writable', 'After 1 write, 0 of which finished, state should be \'writable\'');

    const writePromiseB = ws.write('b');
    t.equal(ws.state, 'writable', 'After 2 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseC = ws.write('c');
    t.equal(ws.state, 'writable', 'After 3 writes, 0 of which finished, state should be \'writable\'');

    const writePromiseD = ws.write('d');
    t.equal(ws.state, 'writable', 'After 4 writes, 0 of which finished, state should be \'writable\'');

    ws.write('e');
    t.equal(ws.state, 'waiting', 'After 5 writes, 0 of which finished, state should be \'waiting\'');

    ws.write('f');
    t.equal(ws.state, 'waiting', 'After 6 writes, 0 of which finished, state should be \'waiting\'');

    ws.write('g');
    t.equal(ws.state, 'waiting', 'After 7 writes, 0 of which finished, state should be \'waiting\'');

    dones.a();
    writePromiseA.then(() => {
      t.equal(ws.state, 'waiting', 'After 7 writes, 1 of which finished, state should be \'waiting\'');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(ws.state, 'waiting', 'After 7 writes, 2 of which finished, state should be \'waiting\'');

        dones.c();
        return writePromiseC.then(() => {
          t.equal(ws.state, 'writable', 'After 7 writes, 3 of which finished, state should be \'writable\'');

          ws.write('h');
          t.equal(ws.state, 'waiting', 'After 8 writes, 3 of which finished, state should be \'waiting\'');

          dones.d();
          return writePromiseD.then(() => {
            t.equal(ws.state, 'writable', 'After 8 writes, 4 of which finished, state should be \'writable\'');

            ws.write('i');
            t.equal(ws.state, 'waiting', 'After 9 writes, 4 of which finished, state should be \'waiting\'');

            t.end();
          });
        });
      });
    })
    .catch(t.error);
  }, 0);
});
