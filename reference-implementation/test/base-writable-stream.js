'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;

require('../index.js');

function writeArrayToStream(array, writableStream) {
  array.forEach(function (chunk) { writableStream.write(chunk); });

  return writableStream.close();
}

test('BaseWritableStream is globally defined', function (t) {
  /*global BaseWritableStream*/
  t.plan(1);

  var basic;
  t.doesNotThrow(function () { basic = new BaseWritableStream(); },
                 'BaseWritableStream is available');
});

test('BaseWritableStream is correctly constructed', function (t) {
  /*global BaseWritableStream*/
  t.plan(7);

  var basic = new BaseWritableStream();

  t.equal(typeof basic.write, 'function', 'has write function');
  t.equal(typeof basic.wait, 'function', 'has wait function');
  t.equal(typeof basic.abort, 'function', 'has abort function');
  t.equal(typeof basic.close, 'function', 'has close function');

  t.equal(basic.state, 'waiting', 'stream has default new state');

  t.ok(basic.closed, 'has closed promise');
  t.ok(basic.closed.then, 'has closed promise that is thenable');
});

test('BaseWritableStream with simple input', function (t) {
  /*global BaseWritableStream*/
  var storage;
  var basic = new BaseWritableStream({
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

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, basic).then(function () {
    t.deepEqual(storage, input, 'got back what was passed in');
    t.end();
  }, function (error) {
    t.fail(error);
    t.end();
  });
});
