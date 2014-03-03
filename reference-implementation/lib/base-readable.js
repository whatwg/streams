'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var promiseCall = require('./helpers').promiseCall;

/*
 *
 * CONSTANTS
 *
 */
var CLOSED_RESOLVE   = '_closedPromise@resolve';
var CLOSED_REJECT    = '_closedPromise@reject';
var READABLE_RESOLVE = '_readablePromise@resolve';
var READABLE_REJECT  = '_readablePromise@reject';


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

  this._storedError = undefined;

  this._readablePromise = new Promise(function (resolve, reject) {
    stream[READABLE_RESOLVE] = resolve;
    stream[READABLE_REJECT] = reject;
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

BaseReadableStream.prototype._push = function _push(data) {
  if (this._state === 'waiting') {
    this._buffer.push(data);
    this._pulling = false;
    this[READABLE_RESOLVE](undefined);
    this._state = 'readable';

    return true;
  }
  else if (this._state === 'readable') {
    this._buffer.push(data);
    this._pulling = false;

    return true;
  }

  return false;
};

BaseReadableStream.prototype._close = function _close() {
  if (this._state === 'waiting') {
    this[READABLE_REJECT](new TypeError('stream has already been completely read'));
    this[CLOSED_RESOLVE](undefined);
    this._state = 'closed';
  }
  else if (this._state === 'readable') {
    this._draining = true;
  }
};

BaseReadableStream.prototype._error = function _error(error) {
  var stream = this;

  if (this._state === 'waiting') {
    this._storedError = error;
    this[CLOSED_REJECT](error);
    this[READABLE_REJECT](error);
    this._state = 'errored';
  }
  else if (this._state === 'readable') {
    this._buffer.length = 0;
    this._storedError = error;
    // do this instead of using Promise.reject so accessors are correct
    this._readablePromise = new Promise(function (resolve, reject) {
      stream[READABLE_RESOLVE] = resolve;
      stream[READABLE_REJECT]  = reject;
    });
    this[READABLE_REJECT](error);
    this[CLOSED_REJECT](error);
    this._state = 'errored';
  }
};

BaseReadableStream.prototype._callPull = function _callPull() {
  var stream = this;

  if (this._pulling === true) return;
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
  }
};

BaseReadableStream.prototype.wait = function wait() {
  if (this._state === 'waiting') this._callPull();

  return this._readablePromise;
};

BaseReadableStream.prototype.read = function read() {
  var stream = this;

  if (this._state === 'closed') {
    throw new TypeError('stream has already been consumed');
  }
  if (this._state === 'errored') {
    throw this._storedError;
  }
  if (this._state === 'waiting') {
    throw new TypeError('no data available (yet)');
  }

  assert(this._state === 'readable', 'stream state ' + this._state + ' is invalid');
  assert(this._buffer.length > 0, 'there must be data available to read');

  var data = this._buffer.shift();

  if (this._buffer.length < 1) {
    assert(this._draining === true || this._draining === false,
           'draining only has two possible states');
    if (this._draining === true) {
      this[CLOSED_RESOLVE](undefined);
      this._readablePromise = Promise.reject(new TypeError('all data already read'));
      this._state = 'closed';
    }
    else {
      this._state = 'waiting';
      this._readablePromise = new Promise(function (resolve, reject) {
        stream[READABLE_RESOLVE] = resolve;
        stream[READABLE_REJECT] = reject;
      });
      this._callPull();
    }
  }

  return data;
};

BaseReadableStream.prototype.cancel = function cancel(reason) {
  if (this._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (this._state === 'errored') {
    return Promise.reject(this._storedError);
  }

  if (this._state === 'waiting') {
    this[READABLE_REJECT](reason);
  }
  if (this._state === 'readable') {
    this._readablePromise = Promise.reject(reason);
  }

  this._state = 'closed';
  this[CLOSED_RESOLVE](undefined);
  this._buffer.length = 0;

  return promiseCall(this._onCancel);
};

BaseReadableStream.prototype.pipeTo = function pipeTo(dest, options) {
  if (options === undefined) options = {};

  var close = true;
  if (options.close !== undefined) close = options.close;
  close = Boolean(close);

  var stream = this;

  function closeDest() { if (close) dest.close(); }

  // ISSUE: should this be preventable via an option or via `options.close`?
  function abortDest(reason) { dest.abort(reason); }
  function cancelSource(reason) { stream.cancel(reason); }

  function pumpSource() {
    switch (stream.state) {
      case 'readable':
        dest.write(stream.read()).catch(cancelSource);
        fillDest();
        break;
      case 'waiting':
        stream.wait().then(fillDest, abortDest);
        break;
      case 'closed':
        closeDest();
        break;
      default:
        abortDest();
    }
  }

  function fillDest() {
    switch (dest.state) {
      case 'writable':
        pumpSource();
        break;
      case 'waiting':
        dest.wait().then(fillDest, cancelSource);
        break;
      default:
        cancelSource();
    }
  }
  fillDest();

  return dest;
};

BaseReadableStream.prototype.pipeThrough = function pipeThrough(transform, options) {
  if (options === undefined) options = {close : true};

  if (!TypeIsObject(transform)) {
    throw new TypeError('Transform streams must be objects.');
  }

  if (!TypeIsObject(transform.input)) {
    throw new TypeError('A transform stream must have an input property that is an object.');
  }

  if (!TypeIsObject(transform.out)) {
    throw new TypeError('A transform stream must have an output property that is an object.');
  }

  this.pipeTo(transform.in, options);
  return transform.out;
};

function TypeIsObject(x) {
  return (typeof x === 'object' && x !== null) || typeof x === 'function';
}

module.exports = BaseReadableStream;
