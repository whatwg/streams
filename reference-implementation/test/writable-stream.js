'use strict';

var test = require('tape');

require('../index.js');

test('WritableStream tests', function (t) {
  /*global WritableStream*/
  var writable;
  t.doesNotThrow(function () { writable = new WritableStream(); },
                 'WritableStream is available');
  t.end();
});
