'use strict';

var SequentialPullSource = require('./sequential-pull-source.js');
var Promise = require('es6-promise').Promise;

module.exports = function sequentialBaseReadableStream(limit, options) {
  var sequentialSource = new SequentialPullSource(limit, options);

  var stream = new BaseReadableStream({
    start : function () {
      return new Promise(function (resolve, reject) {
        sequentialSource.open(function (err) {
          if (err) reject(err);
          resolve();
        });
      });
    },

    pull : function (push, finish, error) {
      sequentialSource.read(function (err, done, data) {
        if (err) {
          error(err);
        } else if (done) {
          sequentialSource.close(function (err) {
            if (err) error(err);
            finish();
          });
        } else {
          push(data);
        }
      });
    }
  });

  stream.source = sequentialSource;

  return stream;
};
