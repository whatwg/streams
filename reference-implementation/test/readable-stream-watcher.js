'use strict';

var test = require('tape');

require('../index.js');

test('ReadableStreamWatcher tests', function (t) {
  /*global ReadableStreamWatcher*/
  var watcher;
  t.doesNotThrow(function () { watcher = new ReadableStreamWatcher(); },
                 'ReadableStreamWatcher is available');
  t.end();
});
