'use strict';

var test = require('tape');

require('../index.js');

test('ReadableStream tests', function (t) {
  /*global ReadableStream*/
  var readable;
  t.doesNotThrow(function () { readable = new ReadableStream(); },
                 'ReadableStream is available');
  t.end();
});
