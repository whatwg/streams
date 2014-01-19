'use strict';

var test = require('tape');

require('../index.js');

test('CountBufferingStrategy tests', function (t) {
  /*global CountBufferingStrategy*/
  var strategy;
  t.doesNotThrow(function () { strategy = new CountBufferingStrategy(); },
                 'CountBufferingStrategy is available');
  t.end();
});
