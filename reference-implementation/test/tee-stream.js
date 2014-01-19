'use strict';

var test = require('tape');

require('../index.js');

test('TeeStream tests', function (t) {
  /*global TeeStream*/
  var tee;
  t.doesNotThrow(function () { tee = new TeeStream(); },
                 'TeeStream is available');
  t.end();
});
