'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;

require('../index.js');

function writeArrayToStream(array, writableStream) {
  array.forEach(function (chunk) { writableStream.write(chunk); });

  return writableStream.close();
}

test('BaseWritableStream tests', function (t) {
  /*global BaseWritableStream*/
  var basic;
  t.doesNotThrow(function () { basic = new BaseWritableStream(); },
                 'BaseWritableStream is available');

  var storage;

  basic = new BaseWritableStream({
    start : function start() { storage = []; },

    write : function write(data, done) {
      setTimeout(function () {
        storage.push(data);
        done();
      });
    },

    close : function close() {
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve();
        });
      });
    }
  });

  t.equal(basic.state, 'waiting', 'stream has default new state');
  t.ok(basic.closed, 'has closed accessor');
  t.ok(basic.write,  'has write function');
  t.ok(basic.wait,   'has write function');
  t.ok(basic.close,  'has close function');
  t.ok(basic.abort,  'has abort function');

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, basic).then(function () {
    t.deepEqual(storage, input, 'got back what was passed in');

    t.end();
  }, function (error) {
    t.fail(error);
    t.end();
  });
});
