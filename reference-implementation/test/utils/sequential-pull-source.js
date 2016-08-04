'use strict';

module.exports = class SequentialPullSource {
  constructor(limit, { async = false } = {}) {
    this.current = 0;
    this.limit = limit;
    this.opened = false;
    this.closed = false;

    this._exec = f => f();
    if (async) {
      this._exec = f => setTimeout(f, 0);
    }
  }

  open(cb) {
    this._exec(() => {
      this.opened = true;
      cb();
    });
  }

  read(cb) {
    this._exec(() => {
      if (++this.current <= this.limit) {
        cb(null, false, this.current);
      } else {
        cb(null, true, null);
      }
    });
  }

  close(cb) {
    this._exec(() => {
      this.closed = true;
      cb();
    });
  }
};
