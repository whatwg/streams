'use strict';
/*global CountQueuingStrategy, ReadableStream */

var test = require('tape');

require('../index.js');

test('Can construct a CountQueuingStrategy with a valid high water mark', function (t) {
  var strategy = new CountQueuingStrategy({ highWaterMark: 4 });
  t.strictEqual(strategy.highWaterMark, 4, '{ highWaterMark: 4 } works');

  t.end();
});

test('Number-ish high water marks get converted to numbers', function (t) {
  var strategy1 = new CountQueuingStrategy({ highWaterMark: '4' });
  t.strictEqual(strategy1.highWaterMark, 4, '{ highWaterMark: \'4\' } works');

  var strategy2 = new CountQueuingStrategy({ highWaterMark: null });
  t.strictEqual(strategy2.highWaterMark, 0, '{ highWaterMark: null } works');

  t.end();
});

test('Gives a RangeError when the number is negative', function (t) {
  t.throws(function () { new CountQueuingStrategy({ highWaterMark: -4 }); },
           RangeError,
           'throws for { highWaterMark: -4 }');

  t.throws(function () { new CountQueuingStrategy({ highWaterMark: '-4' }); },
           RangeError,
           'throws for { highWaterMark: \'-4\' }');

  t.end();
});

test('Can construct a readable stream with a valid CountQueuingStrategy', function (t) {
  t.doesNotThrow(function () {
    new ReadableStream({ strategy: new CountQueuingStrategy({ highWaterMark: 4 }) });
  });

  t.end();
});

test('Correctly governs the return value of a ReadableStream\'s enqueue function (HWM = 4)', function (t) {
  var enqueue;
  var rs = new ReadableStream({
    start: function (enqueue_) { enqueue = enqueue_; },
    strategy: new CountQueuingStrategy({ highWaterMark: 4 })
  });

  t.strictEqual(enqueue('a'), true, 'After 0 reads, 1st enqueue should return true (queue contains 1 chunk)');
  t.strictEqual(enqueue('b'), true, 'After 0 reads, 2nd enqueue should return true (queue contains 2 chunks)');
  t.strictEqual(enqueue('c'), true, 'After 0 reads, 3rd enqueue should return true (queue contains 3 chunks)');
  t.strictEqual(enqueue('d'), false, 'After 0 reads, 4th enqueue should return false (queue contains 4 chunks)');
  t.strictEqual(enqueue('e'), false, 'After 0 reads, 5th enqueue should return false (queue contains 5 chunks)');
  t.strictEqual(enqueue('f'), false, 'After 0 reads, 6th enqueue should return false (queue contains 6 chunks)');

  t.strictEqual(rs.read(), 'a', '1st read gives back the 1st chunk enqueued');
  t.strictEqual(rs.read(), 'b', '2nd read gives back the 2nd chunk enqueued');

  t.strictEqual(enqueue('g'), false, 'After 2 reads, 7th enqueue should return false (queue contains 5 chunks)');

  t.strictEqual(rs.read(), 'c', '3rd read gives back the 3rd chunk enqueued');
  t.strictEqual(rs.read(), 'd', '4th read gives back the 4th chunk enqueued');
  t.strictEqual(rs.read(), 'e', '5th read gives back the 5th chunk enqueued');
  t.strictEqual(rs.read(), 'f', '6th read gives back the 6th chunk enqueued');

  t.strictEqual(enqueue('h'), true, 'After 6 reads, 8th enqueue should return true (queue contains 2 chunks)');
  t.strictEqual(enqueue('i'), true, 'After 6 reads, 9th enqueue should return true (queue contains 3 chunks)');
  t.strictEqual(enqueue('j'), false, 'After 6 reads, 10th enqueue should return false (queue contains 4 chunks)');

  t.end();
});
