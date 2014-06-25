'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var helpers = require('./helpers.js');
var CountQueuingStrategy = require('./count-queuing-strategy.js');

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

  if (options.strategy === undefined) options.strategy = new CountQueuingStrategy({ highWaterMark: 0 });

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
  if (!helpers.typeIsObject(options.strategy)) {
    throw new TypeError('strategy must be an object');
  }

  this._state = 'writable';

  this._onStart = options.start;
  this._onWrite = options.write;
  this._onClose = options.close;
  this._onAbort = options.abort;

  this._strategy = options.strategy;

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
  if (this._queue.length === 0 || this._currentWritePromise !== undefined) {
    return;
  }

  var writeRecord = helpers.peekQueueValue(this._queue);

  if (writeRecord.type === 'close') {
    assert(this._state === 'closing', 'can\'t process final write record unless already closing');
    helpers.dequeueValue(this._queue);
    assert(this._queue.length === 0, 'queue must be empty once the final write record is dequeued');
    this._doClose();
  } else {
    assert(writeRecord.type === 'chunk', 'invalid write record type ' + writeRecord.type);

    this._currentWritePromise = writeRecord.promise;
    this[CURRENT_WRITE_RESOLVE] = writeRecord._resolve;
    this[CURRENT_WRITE_REJECT] = writeRecord._reject;

    var signalDone = function () {
      if (this._currentWritePromise !== writeRecord.promise) return;
      this._currentWritePromise = undefined;
      helpers.dequeueValue(this._queue);
      this._syncStateWithQueue();

      writeRecord._resolve(undefined);
      this._advanceQueue();
    }.bind(this);

    try {
      this._onWrite(writeRecord.chunk, signalDone, this._error.bind(this));
    } catch (error) {
      this._error(error);
    }
  }
};

WritableStream.prototype._syncStateWithQueue = function _syncStateWithQueue() {
  if (this._state === 'closing') {
    return;
  }

  assert(this._state === 'writable' || this._state === 'waiting');

  if (this._state === 'waiting' && this._queue.length === 0) {
    this._state = 'writable';
    this[WRITABLE_RESOLVE](undefined);
    return;
  }

  var queueSize = helpers.getTotalQueueSize(this._queue);
  var needsMore = Boolean(this._strategy.needsMore(queueSize));

  if (needsMore === true && this._state === 'waiting') {
    this._state = 'writable';
    this[WRITABLE_RESOLVE](undefined);
  }

  if (needsMore === false && this._state === 'writable') {
    this._state = 'waiting';
    this._writablePromise = new Promise(function (resolve, reject) {
      this[WRITABLE_RESOLVE] = resolve;
      this[WRITABLE_REJECT] = reject;
    }.bind(this));
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

WritableStream.prototype.write = function write(chunk) {
  var stream = this;

  switch (this._state) {
    case 'waiting':
    case 'writable':
      var chunkSize = this._strategy.size(chunk);

      var resolver, rejecter;
      var promise = new Promise(function (resolve, reject) {
        resolver = resolve;
        rejecter = reject;
      });

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
      this._syncStateWithQueue();
      this._advanceQueue();

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
