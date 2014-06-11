'use strict';

var test = require('tape');

require('../index.js');

test('CountQueuingStrategy tests', function (t) {
  /*global CountQueuingStrategy*/
  var strategy;
  t.doesNotThrow(function () { strategy = new CountQueuingStrategy(); },
                 'CountQueuingStrategy is available');
  t.end();
});
