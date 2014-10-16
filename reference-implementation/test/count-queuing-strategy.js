var test = require('tape');

import CountQueuingStrategy from '../lib/count-queuing-strategy';
import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';

test('Can construct a CountQueuingStrategy with a valid high water mark', t => {
  var strategy = new CountQueuingStrategy({ highWaterMark: 4 });

  t.end();
});

test('Gives a RangeError when the number is negative', t => {
  t.throws(() => new CountQueuingStrategy({ highWaterMark: -4 }),
           /RangeError/,
           'throws for { highWaterMark: -4 }');

  t.throws(() => new CountQueuingStrategy({ highWaterMark: '-4' }),
           /RangeError/,
           'throws for { highWaterMark: \'-4\' }');

  t.end();
});

test('Can construct a readable stream with a valid CountQueuingStrategy', t => {
  t.doesNotThrow(() => new ReadableStream({ strategy: new CountQueuingStrategy({ highWaterMark: 4 }) }));

  t.end();
});

test('Correctly governs the return value of a ReadableStream\'s enqueue function (HWM = 0)', t => {
  var enqueue;
  var rs = new ReadableStream({
    start(enqueue_) { enqueue = enqueue_; },
    strategy: new CountQueuingStrategy({ highWaterMark: 0 })
  });

  t.equal(enqueue('a'), false, 'After 0 reads, 1st enqueue should return false (queue now contains 1 chunk)');
  t.equal(enqueue('b'), false, 'After 0 reads, 2nd enqueue should return false (queue now contains 2 chunks)');
  t.equal(enqueue('c'), false, 'After 0 reads, 3rd enqueue should return false (queue now contains 3 chunks)');
  t.equal(enqueue('d'), false, 'After 0 reads, 4th enqueue should return false (queue now contains 4 chunks)');

  t.equal(rs.read(), 'a', '1st read gives back the 1st chunk enqueued (queue now contains 3 chunks)');
  t.equal(rs.read(), 'b', '2nd read gives back the 2nd chunk enqueued (queue now contains 2 chunks)');
  t.equal(rs.read(), 'c', '3rd read gives back the 2nd chunk enqueued (queue now contains 1 chunk)');

  t.equal(enqueue('e'), false, 'After 3 reads, 5th enqueue should return false (queue now contains 2 chunks)');

  t.equal(rs.read(), 'd', '4th read gives back the 3rd chunk enqueued (queue now contains 1 chunks)');
  t.equal(rs.read(), 'e', '5th read gives back the 4th chunk enqueued (queue now contains 0 chunks)');

  t.equal(enqueue('f'), false, 'After 5 reads, 6th enqueue should return false (queue now contains 1 chunk)');
  t.equal(enqueue('g'), false, 'After 5 reads, 7th enqueue should return false (queue now contains 2 chunks)');

  t.end();
});

test('Correctly governs the return value of a ReadableStream\'s enqueue function (HWM = 1)', t => {
  var enqueue;
  var rs = new ReadableStream({
    start(enqueue_) { enqueue = enqueue_; },
    strategy: new CountQueuingStrategy({ highWaterMark: 1 })
  });

  t.equal(enqueue('a'), true, 'After 0 reads, 1st enqueue should return true (queue now contains 1 chunk)');
  t.equal(enqueue('b'), false, 'After 0 reads, 2nd enqueue should return false (queue now contains 2 chunks)');
  t.equal(enqueue('c'), false, 'After 0 reads, 3rd enqueue should return false (queue now contains 3 chunks)');
  t.equal(enqueue('d'), false, 'After 0 reads, 4th enqueue should return false (queue now contains 4 chunks)');

  t.equal(rs.read(), 'a', '1st read gives back the 1st chunk enqueued (queue now contains 3 chunks)');
  t.equal(rs.read(), 'b', '2nd read gives back the 2nd chunk enqueued (queue now contains 2 chunks)');
  t.equal(rs.read(), 'c', '3rd read gives back the 2nd chunk enqueued (queue now contains 1 chunk)');

  t.equal(enqueue('e'), false, 'After 3 reads, 5th enqueue should return false (queue now contains 2 chunks)');

  t.equal(rs.read(), 'd', '4th read gives back the 3rd chunk enqueued (queue now contains 1 chunks)');
  t.equal(rs.read(), 'e', '5th read gives back the 4th chunk enqueued (queue now contains 0 chunks)');

  t.equal(enqueue('f'), true, 'After 5 reads, 6th enqueue should return true (queue now contains 1 chunk)');
  t.equal(enqueue('g'), false, 'After 5 reads, 7th enqueue should return false (queue now contains 2 chunks)');

  t.end();
});

test('Correctly governs the return value of a ReadableStream\'s enqueue function (HWM = 4)', t => {
  var enqueue;
  var rs = new ReadableStream({
    start(enqueue_) { enqueue = enqueue_; },
    strategy: new CountQueuingStrategy({ highWaterMark: 4 })
  });

  t.equal(enqueue('a'), true, 'After 0 reads, 1st enqueue should return true (queue now contains 1 chunk)');
  t.equal(enqueue('b'), true, 'After 0 reads, 2nd enqueue should return true (queue now contains 2 chunks)');
  t.equal(enqueue('c'), true, 'After 0 reads, 3rd enqueue should return true (queue now contains 3 chunks)');
  t.equal(enqueue('d'), true, 'After 0 reads, 4th enqueue should return true (queue now contains 4 chunks)');
  t.equal(enqueue('e'), false, 'After 0 reads, 5th enqueue should return false (queue now contains 5 chunks)');
  t.equal(enqueue('f'), false, 'After 0 reads, 6th enqueue should return false (queue now contains 6 chunks)');

  t.equal(rs.read(), 'a', '1st read gives back the 1st chunk enqueued (queue now contains 5 chunks)');
  t.equal(rs.read(), 'b', '2nd read gives back the 2nd chunk enqueued (queue now contains 4 chunks)');

  t.equal(enqueue('g'), false, 'After 2 reads, 7th enqueue should return false (queue now contains 5 chunks)');

  t.equal(rs.read(), 'c', '3rd read gives back the 3rd chunk enqueued (queue now contains 4 chunks)');
  t.equal(rs.read(), 'd', '4th read gives back the 4th chunk enqueued (queue now contains 3 chunks)');
  t.equal(rs.read(), 'e', '5th read gives back the 5th chunk enqueued (queue now contains 2 chunks)');
  t.equal(rs.read(), 'f', '6th read gives back the 6th chunk enqueued (queue now contains 1 chunk)');

  t.equal(enqueue('h'), true, 'After 6 reads, 8th enqueue should return true (queue now contains 2 chunks)');
  t.equal(enqueue('i'), true, 'After 6 reads, 9th enqueue should return true (queue now contains 3 chunks)');
  t.equal(enqueue('j'), true, 'After 6 reads, 10th enqueue should return true (queue now contains 4 chunks)');
  t.equal(enqueue('k'), false, 'After 6 reads, 11th enqueue should return false (queue now contains 5 chunks)');

  t.end();
});

test('Can construct a writable stream with a valid CountQueuingStrategy', t => {
  t.doesNotThrow(() => new WritableStream({ strategy: new CountQueuingStrategy({ highWaterMark: 4 }) }));

  t.end();
});

test('Correctly governs the value of a WritableStream\'s state property (HWM = 0)', t => {
  var dones = Object.create(null);

  var ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => dones[chunk] = resolve);
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 0 })
  });

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    var writePromiseA = ws.write('a');
    t.equal(ws.state, 'waiting', 'After 1 write, 0 of which finished, state should be \'waiting\'');

    var writePromiseB = ws.write('b');
    t.equal(ws.state, 'waiting', 'After 2 writes, 0 of which finished, state should be \'waiting\'');

    dones.a();
    writePromiseA.then(() => {
      t.equal(ws.state, 'waiting', 'After 2 writes, 1 of which finished, state should be \'waiting\'');

      dones.b();
      return writePromiseB.then(() => {
        t.equal(ws.state, 'writable', 'After 2 writes, 2 of which finished, state should be \'writable\'');

        var writePromiseC = ws.write('c');
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
  var dones = Object.create(null);

  var ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => dones[chunk] = resolve);
    },
    strategy: new CountQueuingStrategy({ highWaterMark: 4 })
  });

  setTimeout(() => {
    t.equal(ws.state, 'writable', 'After 0 writes, 0 of which finished, state should be \'writable\'');

    var writePromiseA = ws.write('a');
    t.equal(ws.state, 'writable', 'After 1 write, 0 of which finished, state should be \'writable\'');

    var writePromiseB = ws.write('b');
    t.equal(ws.state, 'writable', 'After 2 writes, 0 of which finished, state should be \'writable\'');

    var writePromiseC = ws.write('c');
    t.equal(ws.state, 'writable', 'After 3 writes, 0 of which finished, state should be \'writable\'');

    var writePromiseD = ws.write('d');
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
