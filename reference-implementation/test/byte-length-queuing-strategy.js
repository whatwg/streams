var test = require('tape');

import ByteLengthQueuingStrategy from '../lib/byte-length-queuing-strategy';

test('Can construct a ByteLengthQueuingStrategy with a valid high water mark', function (t) {
  var strategy = new ByteLengthQueuingStrategy({ highWaterMark: 4 });
  t.strictEqual(strategy.highWaterMark, 4, '{ highWaterMark: 4 } works');

  t.end();
});
