'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var helpers = require('./helpers');

/*
 *
 * CONSTANTS
 *
 */
var CLOSED_RESOLVE = '_closedPromise@resolve';
var CLOSED_REJECT  = '_closedPromise@reject';
var WAIT_RESOLVE   = '_waitPromise@resolve';
var WAIT_REJECT    = '_waitPromise@reject';


function ReadableStream(options) {
  var stream = this;

  if (options === undefined) options = {};
  if (options.start === undefined) options.start = function _onStart() {};
  if (options.pull === undefined) options.pull = function _onPull() {};
  if (options.cancel === undefined) options.cancel = function _onCancel() {};

  if (options.strategy === undefined) options.strategy = {};
  if (options.strategy.size === undefined) options.strategy.size = function () { return 0; };
  if (options.strategy.needsMore === undefined) options.strategy.needsMore = function () { return false; };

  if (typeof options.start !== 'function') {
    throw new TypeError('start must be a function or undefined');
  }
  if (typeof options.pull !== 'function') {
    throw new TypeError('pull must be a function or undefined');
  }
  if (typeof options.cancel !== 'function') {
    throw new TypeError('cancel must be a function or undefined');
  }
  if (typeof options.strategy.size !== 'function') {
    throw new TypeError('strategy.size must be a function or undefined');
  }
  if (typeof options.strategy.needsMore !== 'function') {
    throw new TypeError('strategy.needsMore must be a function or undefined');
  }

  this._state    = 'waiting';
  this._draining = false;
  this._pulling  = false;
  this._started  = false;

  this._onStart  = options.start;
  this._onPull   = options.pull;
  this._onCancel = options.cancel;

  this._strategySize      = options.strategy.size.bind(options.strategy);
  this._strategyNeedsMore = options.strategy.needsMore.bind(options.strategy);

  this._storedError = undefined;

  this._waitPromise = new Promise(function (resolve, reject) {
    stream[WAIT_RESOLVE] = resolve;
    stream[WAIT_REJECT] = reject;
  });

  this._closedPromise = new Promise(function (resolve, reject) {
    stream[CLOSED_RESOLVE] = resolve;
    stream[CLOSED_REJECT]  = reject;
  });

  this._queue = [];

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
      this._enqueue.bind(this),
      this._close.bind(this),
      this._error.bind(this)
    )
  );

  this._startedPromise.then(function started() { stream._started = true; });
  this._startedPromise.catch(function error(e) { stream._error(e); });
}

ReadableStream.prototype._enqueue = function _enqueue(chunk) {
  if (this._state === 'waiting' || this._state === 'readable') {
    var chunkSize = this._strategySize(chunk);
    helpers.enqueueValueWithSize(this._queue, chunk, chunkSize);
    this._pulling = false;
  }
  if (this._state === 'waiting') {
    this._state = 'readable';
    this[WAIT_RESOLVE](undefined);

    return true;
  }
  if (this._state === 'readable') {
    var queueSize = helpers.getTotalQueueSize(this._queue);
    return this._strategyNeedsMore(queueSize);
  }

  return false;
};

ReadableStream.prototype._close = function _close() {
  if (this._state === 'waiting') {
    this._state = 'closed';
    this[WAIT_RESOLVE](undefined);
    this[CLOSED_RESOLVE](undefined);
  }
  else if (this._state === 'readable') {
    this._draining = true;
  }
};

ReadableStream.prototype._error = function _error(error) {
  var stream = this;

  if (this._state === 'waiting') {
    this._state = 'errored';
    this._storedError = error;
    this[WAIT_REJECT](error);
    this[CLOSED_REJECT](error);
  }
  else if (this._state === 'readable') {
    this._queue = [];
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

ReadableStream.prototype._callPull = function _callPull() {
  var stream = this;

  if (this._pulling === true) return;
  this._pulling = true;

  if (this._started === false) {
    this._startedPromise.then(function fulfilled() {
      try {
        stream._onPull(
          stream._enqueue.bind(this),
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
        stream._enqueue.bind(this),
        stream._close.bind(this),
        stream._error.bind(this)
      );
    } catch (pullResultE) {
      this._error(pullResultE);
    }
  }
};

ReadableStream.prototype.wait = function wait() {
  if (this._state === 'waiting') this._callPull();

  return this._waitPromise;
};

ReadableStream.prototype.read = function read() {
  var stream = this;

  if (this._state === 'waiting') {
    throw new TypeError('no chunks available (yet)');
  }
  if (this._state === 'closed') {
    throw new TypeError('stream has already been consumed');
  }
  if (this._state === 'errored') {
    throw this._storedError;
  }

  assert(this._state === 'readable', 'stream state ' + this._state + ' is invalid');
  assert(this._queue.length > 0, 'there must be chunks available to read');

  var chunk = helpers.dequeueValue(this._queue);

  if (this._queue.length < 1) {
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

  return chunk;
};

ReadableStream.prototype.cancel = function cancel() {
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

  this._queue = [];
  this._state = 'closed';
  this[CLOSED_RESOLVE](undefined);

  return helpers.promiseCall(this._onCancel);
};

ReadableStream.prototype.pipeTo = function pipeTo(dest, options) {
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

ReadableStream.prototype.pipeThrough = function pipeThrough(transform, options) {
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

module.exports = ReadableStream;
