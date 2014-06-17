'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var helpers = require('./helpers');

/*
 *
 * CONSTANTS
 *
 */
var CLOSED_RESOLVE        = '_closedPromise@resolve';
var CLOSED_REJECT         = '_closedPromise@reject';
var WRITABLE_RESOLVE      = '_writablePromise@resolve';
var WRITABLE_REJECT       = '_writablePromise@reject';
var CURRENT_WRITE_RESOLVE = '_currentWritePromise@resolve';
var CURRENT_WRITE_REJECT  = '_currentWritePromise@reject';

function WritableStream(options) {
  var stream = this;

  if (options === undefined) options = {};
  if (options.start === undefined) options.start = function _onStart() {};
  if (options.write === undefined) options.write = function _onWrite() {};
  if (options.close === undefined) options.close = function _onClose() {};
  if (options.abort === undefined) options.abort = function _onAbort() {};

  if (options.strategy === undefined) options.strategy = {};
  if (options.strategy.size === undefined) options.strategy.size = function () { return 0; };
  if (options.strategy.needsMore === undefined) options.strategy.needsMore = function () { return false; };

  if (typeof options.start !== 'function') {
    throw new TypeError('start must be a function or undefined');
  }
  if (typeof options.write !== 'function') {
    throw new TypeError('write must be a function or undefined');
  }
  if (typeof options.close !== 'function') {
    throw new TypeError('close must be a function or undefined');
  }
  if (typeof options.abort !== 'function') {
    throw new TypeError('abort must be a function or undefined');
  }
  if (typeof options.strategy.size !== 'function') {
    throw new TypeError('strategy.size must be a function or undefined');
  }
  if (typeof options.strategy.needsMore !== 'function') {
    throw new TypeError('strategy.needsMore must be a function or undefined');
  }

  this._state = 'writable';

  this._onStart = options.start;
  this._onWrite = options.write;
  this._onClose = options.close;
  this._onAbort = options.abort;

  this._strategySize      = options.strategy.size.bind(options.strategy);
  this._strategyNeedsMore = options.strategy.needsMore.bind(options.strategy);

  this._storedError = undefined;

  this._writablePromise      = new Promise(function (resolve, reject) {
    stream[WRITABLE_RESOLVE] = resolve;
    stream[WRITABLE_REJECT]  = reject;
  });

  this._closedPromise      = new Promise(function (resolve, reject) {
    stream[CLOSED_RESOLVE] = resolve;
    stream[CLOSED_REJECT]  = reject;
  });

  this._queue = [];

  this._currentWritePromise   = undefined;
  this[CURRENT_WRITE_RESOLVE] = undefined;
  this[CURRENT_WRITE_REJECT]  = undefined;

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

  this._startedPromise = Promise.cast(this._onStart());
  this._startedPromise.then(
    function fulfill() { stream._advanceQueue(); },
    function error(e)  { stream._error(e); }
  );
}

WritableStream.prototype._error = function _error(error) {
  if (this._state === 'closed' || this._state === 'errored') {
    return;
  }

  for (var i = 0; i < this._queue.length; i++) {
    this._queue[i]._reject(error);
  }
  this._queue = [];
  this._state = 'errored';
  this._storedError = error;
  this[WRITABLE_REJECT](error);
  this[CLOSED_REJECT](error);
};

WritableStream.prototype._advanceQueue = function _advanceQueue() {
  if (this._queue.length > 0) {
    var writeRecord = helpers.dequeueValue(this._queue);
    this._doNextWrite(
      writeRecord.type,
      writeRecord.promise,
      writeRecord.chunk,
      { _resolve: writeRecord._resolve, _reject: writeRecord._reject }
    );
  }
  else {
    this._state = 'writable';
    this[WRITABLE_RESOLVE](undefined);
  }
};

WritableStream.prototype._doClose = function _doClose() {
  var stream = this;

  this[WRITABLE_REJECT](new TypeError('stream has already been closed'));

  var closePromise = helpers.promiseCall(this._onClose);

  closePromise.then(
    function () {
      stream._state = 'closed';
      stream[CLOSED_RESOLVE](undefined);
    },
    function (r) {
      stream._error(r);
    }
  );
};

WritableStream.prototype._doNextWrite = function _doNextWrite(type, promise, chunk, promiseManipulators) {
  var stream = this;

  var resolve = promiseManipulators._resolve;
  var reject  = promiseManipulators._reject;

  if (type === 'close') {
    assert(this._state === 'closing', 'can\'t write final write record unless already closing');
    this._doClose();
    return;
  }

  assert(type === 'chunk', 'invalid write record type ' + type);

  this._currentWritePromise   = promise;
  this[CURRENT_WRITE_RESOLVE] = resolve;
  this[CURRENT_WRITE_REJECT]  = reject;

  function signalDone() {
    if (stream._currentWritePromise !== promise) return;
    stream._currentWritePromise = undefined;

    if (stream._state === 'waiting') {
      resolve(undefined);
      stream._advanceQueue();
    }
    else if (stream._state === 'closing') {
      resolve(undefined);

      if (stream._queue.length > 0) {
        var writeRecord = helpers.dequeueValue(this._queue);
        this._doNextWrite(
          writeRecord.type,
          writeRecord.promise,
          writeRecord.chunk,
          { _resolve: writeRecord._resolve, _reject: writeRecord._reject }
        );
      }
    }
  }

  try {
    this._onWrite(chunk, signalDone, this._error.bind(this));
  }
  catch (error) {
    this._error(error);
  }
};

WritableStream.prototype.write = function write(chunk) {
  var stream = this;

  var resolver, rejecter;
  var promise = new Promise(function (resolve, reject) {
    resolver = resolve;
    rejecter = reject;
  });

  switch (this._state) {
    case 'waiting':
      var chunkSize = this._strategySize(chunk);

      helpers.enqueueValueWithSize(
        this._queue,
        {
          type     : 'chunk',
          promise  : promise,
          chunk    : chunk,
          _resolve : resolver,
          _reject  : rejecter
        },
        chunkSize
      );

      return promise;

    case 'writable':
      if (this._queue.length === 0) {
        this._doNextWrite('chunk', promise, chunk, { _resolve: resolver, _reject: rejecter });
      } else {
        var chunkSize = this._strategySize(chunk);
        var queueSize = helpers.getTotalQueueSize(this._queue);
        var needsMore = this._strategyNeedsMore(queueSize);

        if (!needsMore) {
          this._state = 'waiting';
          this._writablePromise = new Promise(function (resolve, reject) {
            stream[WRITABLE_RESOLVE] = resolve;
            stream[WRITABLE_REJECT] = reject;
          });
        }

        helpers.enqueueValueWithSize(
          this._queue,
          {
            type     : 'chunk',
            promise  : promise,
            chunk    : chunk,
            _resolve : resolver,
            _reject  : rejecter
          },
          chunkSize
        );
      }

      return promise;

    case 'closing':
      return Promise.reject(new TypeError('cannot write while stream is closing'));

    case 'closed':
      return Promise.reject(new TypeError('cannot write after stream is closed'));

    case 'errored':
      return Promise.reject(this._storedError);

    default:
      assert(false, 'stream is in invalid state ' + this._state);
  }
};

WritableStream.prototype.close = function close() {
  switch (this._state) {
    case 'writable':
      this._state = 'closing';
      this._doClose();
      return this._closedPromise;

    case 'waiting':
      this._state = 'closing';
      helpers.enqueueValueWithSize(this._queue, { type: 'close', promise: this._closedPromise, chunk: undefined }, 0);
      return this._closedPromise;

    case 'closing':
      return Promise.reject(new TypeError('cannot close an already-closing stream'));

    case 'closed':
      return Promise.reject(new TypeError('cannot close an already-closed stream'));

    case 'errored':
      return Promise.reject(this._storedError);

    default:
      assert(false, 'stream is in invalid state ' + this._state);
  }
};

WritableStream.prototype.abort = function abort(r) {
  switch (this._state) {
    case 'closed':
      return Promise.resolve(undefined);
    case 'errored':
      return Promise.reject(this._storedError);
    default:
      this._error(reason);
      return helpers.promiseCall(this._onAbort);
  }
};

WritableStream.prototype.wait = function wait() {
  return this._writablePromise;
};

module.exports = WritableStream;
