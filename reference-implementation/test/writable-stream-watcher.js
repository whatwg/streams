'use strict';

var test = require('tape');

require('../index.js');

test('WritableStreamWatcher tests', function (t) {
  /*global WritableStreamWatcher*/
  var watcher;
  t.doesNotThrow(function () { watcher = new WritableStreamWatcher(); },
                 'WritableStreamWatcher is available');
  t.end();
});
