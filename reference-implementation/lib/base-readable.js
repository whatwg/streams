'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var promiseCall = require('./helpers').promiseCall;

/*
 *
 * CONSTANTS
 *
 */
var CLOSED_RESOLVE = '_closedPromise@resolve';
var CLOSED_REJECT  = '_closedPromise@reject';
var WAIT_RESOLVE   = '_waitPromise@resolve';
var WAIT_REJECT    = '_waitPromise@reject';


function BaseReadableStream(callbacks) {
  var stream = this;

  if (callbacks === undefined) callbacks = {};
  if (callbacks.start === undefined) callbacks.start = function _onStart() {};
  if (callbacks.pull === undefined) callbacks.pull = function _onPull() {};
  if (callbacks.cancel === undefined) callbacks.cancel = function _onCancel() {};

  if (typeof callbacks.start !== 'function') {
    throw new TypeError('start must be a function or undefined');
  }
  if (typeof callbacks.pull !== 'function') {
    throw new TypeError('pull must be a function or undefined');
  }
  if (typeof callbacks.cancel !== 'function') {
    throw new TypeError('cancel must be a function or undefined');
  }

  this._buffer   = [];
  this._state    = 'waiting';
  this._draining = false;
  this._pulling  = false;
  this._started  = false;

  this._onStart = callbacks.start;
  this._onPull  = callbacks.pull;
  this._onCancel = callbacks.cancel;

  this._pipeDest = undefined;
  this._pipeClose = undefined;
  this._storedError = undefined;

  this._waitPromise = new Promise(function (resolve, reject) {
    stream[WAIT_RESOLVE] = resolve;
    stream[WAIT_REJECT] = reject;
  });

  this._closedPromise = new Promise(function (resolve, reject) {
    stream[CLOSED_RESOLVE] = resolve;
    stream[CLOSED_REJECT]  = reject;
  });

  Object.defineProperty(this, 'state', {
    configurable : false,
    enumerable   : true,
    get          : function () { return stream._state; }
  });

  Object.defineProperty(this, 'closed', {
    configurable : false,
    enumerable   : true,
    get          : function () { return stream._closedPromise; }
  });

  this._startedPromise = Promise.cast(
    this._onStart(
      this._push.bind(this),
      this._close.bind(this),
      this._error.bind(this)
    )
  );

  this._startedPromise.then(function started() { stream._started = true; });
  this._startedPromise.catch(function error(e) { stream._error(e); });
}

BaseReadableStream.prototype._fillPipeDest = function _fillPipeDest() {
  assert(this._pipeDest !== undefined);
  assert(this._pipeClose !== undefined);

  // Move available data into a receptive destination.
  while (this._pipeDest.state === 'writable' && this._buffer.length > 0) {
    var data = this._buffer.shift();
    this._pipeDest.write(data).catch(this.cancel.bind(this));
  }

  if (this._buffer.length === 0) {
    if (this._draining === true) {
      // If moving that data drained the entire stream, then we're done here.
      this._state = 'closed';
      this[CLOSED_RESOLVE](undefined); // this will also resolve this._waitPromise.

      if (this._pipeClose) {
        this._pipeDest.close();
      }

      this._pipeDest = undefined;
    } else {
      if (this._pulling) {
        process.nextTick(this._callPull.bind(this));
      } else {
        this._callPull();
      }
    }
  }
};

BaseReadableStream.prototype._push = function _push(data) {
  if (this._state === 'closed' || this._state === 'errored') {
    return false;
  }

  this._buffer.push(data);

  if (this._pipeDest !== undefined) {
    if (this._pipeDest.state === 'writable') {
      this._fillPipeDest();

      return this._pipeDest.state === 'writable';
    } else if (this._pipeDest.state === 'waiting') {
      this._pipeDest.wait().then(this._fillPipeDest.bind(this), this.cancel.bind(this));
    } else {
      // Destination has either been closed by someone else, or has errored in the course of someone else writing.
      // Either way, we're not going to be able to do anything else useful.
      this.cancel();
    }

    return false;
  } else {
    if (this._state === 'waiting') {
      this._state = 'readable';
      this[WAIT_RESOLVE](undefined);

      return true;
    }
  }

  return false;
};

BaseReadableStream.prototype._close = function _close() {
  if (this._pipeDest !== undefined) {
    this._draining = true;
    this._fillPipeDest();
  } else {
    if (this._state === 'waiting') {
      this._state = 'closed';
      this[WAIT_RESOLVE](undefined);
      this[CLOSED_RESOLVE](undefined);
    }
    else if (this._state === 'readable') {
      this._draining = true;
    }
  }
};

BaseReadableStream.prototype._error = function _error(error) {
  var stream = this;

  if (this._state === 'waiting') {
    this._state = 'errored';
    this._storedError = error;
    this[WAIT_REJECT](error);
    this[CLOSED_REJECT](error);
  }
  else if (this._state === 'readable') {
    this._buffer.length = 0;
    this._state = 'errored';
    this._storedError = error;
    // do this instead of using Promise.reject so accessors are correct
    this._waitPromise = new Promise(function (resolve, reject) {
      stream[WAIT_RESOLVE] = resolve;
      stream[WAIT_REJECT]  = reject;
    });
    this[WAIT_REJECT](error);
    this[CLOSED_REJECT](error);
  }
};

BaseReadableStream.prototype._callPull = function _callPull() {
  var stream = this;

  if (this._pulling === true || this._draining === true) return;
  this._pulling = true;

  if (this._started === false) {
    this._startedPromise.then(function fulfilled() {
      try {
        stream._onPull(
          stream._push.bind(this),
          stream._close.bind(this),
          stream._error.bind(this)
        );
      } catch (pullResultE) {
        this._error(pullResultE);
      }
      this._pulling = false;
    }.bind(this));
  } else {
    try {
      stream._onPull(
        stream._push.bind(this),
        stream._close.bind(this),
        stream._error.bind(this)
      );
    } catch (pullResultE) {
      this._error(pullResultE);
    }
    this._pulling = false;
  }
};

BaseReadableStream.prototype.wait = function wait() {
  if (this._state === 'waiting') this._callPull();

  return this._waitPromise;
};

BaseReadableStream.prototype.read = function read() {
  var stream = this;

  if (this._state === 'waiting') {
    throw new TypeError('no data available (yet)');
  }
  if (this._state === 'closed') {
    throw new TypeError('stream has already been consumed');
  }
  if (this._state === 'errored') {
    throw this._storedError;
  }
  if (this._pipeDest !== undefined) {
    throw new TypeError('Cannot read directly from a stream that is being piped!');
  }

  assert(this._state === 'readable', 'stream state ' + this._state + ' is invalid');
  assert(this._buffer.length > 0, 'there must be data available to read');

  var data = this._buffer.shift();

  if (this._buffer.length === 0) {
    assert(this._draining === true || this._draining === false,
           'draining only has two possible states');
    if (this._draining === true) {
        this._state = 'closed';
        this._waitPromise = Promise.resolve(undefined);
        this[CLOSED_RESOLVE](undefined);
    }
    else {
      this._state = 'waiting';
      this._waitPromise = new Promise(function (resolve, reject) {
        stream[WAIT_RESOLVE] = resolve;
        stream[WAIT_REJECT] = reject;
      });
      this._callPull();
    }
  }

  return data;
};

BaseReadableStream.prototype.cancel = function cancel() {
  if (this._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (this._state === 'errored') {
    return Promise.reject(this._storedError);
  }

  if (this._state === 'waiting') {
    this[WAIT_RESOLVE](undefined);
  }
  if (this._state === 'readable') {
    this._waitPromise = Promise.resolve(undefined);
  }

  // TODO: consolidate with other code like this? E.g. in pipeTo and read?
  this._buffer.length = 0;
  this._state = 'closed';
  this[CLOSED_RESOLVE](undefined);
  this._pipeDest = undefined;

  return promiseCall(this._onCancel);
};

BaseReadableStream.prototype.pipeTo = function pipeTo(dest, options) {
  if (options === undefined) options = {};

  var close = true;
  if (options.close !== undefined) close = options.close;
  close = Boolean(close);

  var stream = this;

  if (this._pipeDest !== undefined) {
    throw new TypeError('Cannot pipe to two streams at once. Consider a tee stream!');
  }

  this._pipeDest = dest;
  this._pipeClose = close;
  this._state = 'waiting';
  this._waitPromise = this._closedPromise; // TODO: if we add unpipe this doesn't work.

  // Initial movement of any available data into a receptive destination.
  this._fillPipeDest();
};

BaseReadableStream.prototype.pipeThrough = function pipeThrough(transform, options) {
  if (options === undefined) options = {close : true};

  if (!TypeIsObject(transform)) {
    throw new TypeError('Transform streams must be objects.');
  }

  if (!TypeIsObject(transform.input)) {
    throw new TypeError('A transform stream must have an input property that is an object.');
  }

  if (!TypeIsObject(transform.output)) {
    throw new TypeError('A transform stream must have an output property that is an object.');
  }

  this.pipeTo(transform.input, options);
  return transform.output;
};

function TypeIsObject(x) {
  return (typeof x === 'object' && x !== null) || typeof x === 'function';
}

module.exports = BaseReadableStream;
