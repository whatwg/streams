'use strict';

var Promise = require('es6-promise').Promise;

module.exports = function readableStreamToArray(readable) {
  return new Promise(function (resolve, reject) {
    var chunks = [];

    readable.closed.then(function () { resolve(chunks); }, reject);

    function pump() {
      while (readable.state === 'readable') {
        var data = readable.read();
        chunks.push(data);
      }

      if (readable.state === 'waiting') readable.wait().then(pump);
    }

    pump();
  });
};
