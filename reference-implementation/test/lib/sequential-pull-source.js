'use strict';

function SequentialPullSource(limit, options) {
  this.current = 0;
  this.limit   = limit;
  this.opened  = false;
  this.closed  = false;

  var that = this;
  this._exec = function (func) { func.call(that); };
  if (options && options.async) {
    this._exec = function (func) {
      process.nextTick(function () {
        func.call(that);
      });
    };
  }
}

SequentialPullSource.prototype.open = function (cb) {
  this._exec(function () {
    this.opened = true;
    cb();
  });
};

SequentialPullSource.prototype.read = function (cb) {
  this._exec(function () {
    if (++this.current <= this.limit) {
      cb(null, false, this.current);
    } else {
      cb(null, true, null);
    }
  });
};

SequentialPullSource.prototype.close = function (cb) {
  this._exec(function () {
    this.closed = true;
    cb();
  });
}

module.exports = SequentialPullSource;
