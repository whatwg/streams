'use strict';

var test = require('tape');

require('../index.js');

test('BaseWritableStream tests', function (t) {
  /*global BaseWritableStream*/
  var basic;
  t.doesNotThrow(function () { basic = new BaseWritableStream(); },
                 'BaseWritableStream is available');
  t.end();
});
