'use strict';

var test = require('tape');
var Promise = require('es6-promise').Promise;

require('../index.js');

function writeArrayToStream(array, writableStream) {
  array.forEach(function (chunk) { writableStream.write(chunk); });

  return writableStream.close();
}

test('WritableStream is globally defined', function (t) {
  /*global WritableStream*/
  t.plan(1);

  var basic;
  t.doesNotThrow(function () { basic = new WritableStream(); },
                 'WritableStream is available');
});

test('WritableStream is correctly constructed', function (t) {
  /*global WritableStream*/
  t.plan(7);

  var basic = new WritableStream();

  t.equal(typeof basic.write, 'function', 'has write function');
  t.equal(typeof basic.wait, 'function', 'has wait function');
  t.equal(typeof basic.abort, 'function', 'has abort function');
  t.equal(typeof basic.close, 'function', 'has close function');

  t.equal(basic.state, 'writable', 'stream has default new state');

  t.ok(basic.closed, 'has closed promise');
  t.ok(basic.closed.then, 'has closed promise that is thenable');
});

test('WritableStream with simple input, processed asynchronously', function (t) {
  /*global WritableStream*/
  var storage;
  var basic = new WritableStream({
    start : function start() { storage = []; },

    write : function write(chunk, done) {
      setTimeout(function () {
        storage.push(chunk);
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
    t.deepEqual(storage, input, 'correct data was relayed to underlying sink');
    t.end();
  }, function (error) {
    t.fail(error);
    t.end();
  });
});

test('WritableStream with simple input, processed synchronously', function (t) {
  var storage;
  var basic = new WritableStream({
    start : function start() { storage = []; },

    write : function write(chunk, done) {
      storage.push(chunk);
      done();
    }
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, basic).then(function () {
    t.deepEqual(storage, input, 'correct data was relayed to underlying sink');
    t.end();
  }, function (error) {
    t.fail(error);
    t.end();
  });
});

test('WritableStream: stays writable indefinitely if writes are all acknowledged synchronously', function (t) {
  t.plan(10);

  var ws = new WritableStream({
    write : function (chunk, done) {
      t.equal(this.state, 'waiting', 'state is waiting before writing ' + chunk);
      done();
      t.equal(this.state, 'writable', 'state is writable after writing ' + chunk);
    }
  });

  var input = [1, 2, 3, 4, 5];
  writeArrayToStream(input, ws).then(function () {
    t.end();
  }, function (error) {
    t.fail(error);
    t.end();
  });
});

test('WritableStream: transitions to waiting after one write that is not synchronously acknowledged', function (t) {
  var done;
  var ws = new WritableStream({
    write : function (chunk, done_) {
      done = done_;
    }
  });

  t.strictEqual(ws.state, 'writable', 'state starts writable');
  ws.write('a');
  t.strictEqual(ws.state, 'waiting', 'state is waiting until the write finishes');
  done();
  t.strictEqual(ws.state, 'writable', 'state becomes writable again after the write finishes');

  t.end();
});
