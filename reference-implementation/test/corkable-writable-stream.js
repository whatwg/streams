'use strict';

var test = require('tape');

require('../index.js');

test('CorkableWritableStream tests', function (t) {
  /*global CorkableWritableStream*/
  var corkable;
  t.doesNotThrow(function () { corkable = new CorkableWritableStream(); },
                 'CorkableWritableStream is available');
  t.end();
});
