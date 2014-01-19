'use strict';

var test = require('tape');

require('../index.js');

test('BaseReadableStream tests', function (t) {
  /*global BaseReadableStream*/
  var basic;
  t.doesNotThrow(function () { basic = new BaseReadableStream(); },
                 'BaseReadableStream is available');
  t.end();
});
