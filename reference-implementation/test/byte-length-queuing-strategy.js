'use strict';

var test = require('tape');

require('../index.js');

test('ByteLengthQueuingStrategy tests', function (t) {
  /*global ByteLengthQueuingStrategy*/
  var strategy;
  t.doesNotThrow(function () { strategy = new ByteLengthQueuingStrategy(); },
                 'ByteLengthQueuingStrategy is available');
  t.end();
});
