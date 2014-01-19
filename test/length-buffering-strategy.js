'use strict';

var test = require('tape');

require('../index.js');

test('LengthBufferingStrategy tests', function (t) {
  /*global LengthBufferingStrategy*/
  var strategy;
  t.doesNotThrow(function () { strategy = new LengthBufferingStrategy(); },
                 'LengthBufferingStrategy is available');
  t.end();
});
