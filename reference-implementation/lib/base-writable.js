'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;
var promiseCall = require('./helpers').promiseCall;

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

function BaseWritableStream(callbacks) {
  var stream = this;

  if (callbacks === undefined) callbacks = {};
  if (callbacks.start === undefined) callbacks.start = function _onStart() {};
  if (callbacks.write === undefined) callbacks.write = function _onWrite() {};
  if (callbacks.close === undefined) callbacks.close = function _onClose() {};
  if (callbacks.abort === undefined) callbacks.abort = function _onAbort() {};

  if (typeof callbacks.start !== 'function') {
    throw new TypeError('start must be a function or undefined');
  }
  if (typeof callbacks.write !== 'function') {
    throw new TypeError('write must be a function or undefined');
  }
  if (typeof callbacks.close !== 'function') {
    throw new TypeError('close must be a function or undefined');
  }
  if (typeof callbacks.abort !== 'function') {
    throw new TypeError('abort must be a function or undefined');
  }

  this._buffer = [];

  this._state = 'waiting';

  this._onStart = callbacks.start;
  this._onWrite = callbacks.write;
  this._onClose = callbacks.close;
  this._onAbort = callbacks.abort;

  this._storedError = undefined;

  this._writablePromise      = new Promise(function (resolve, reject) {
    stream[WRITABLE_RESOLVE] = resolve;
    stream[WRITABLE_REJECT]  = reject;
  });

  this._closedPromise      = new Promise(function (resolve, reject) {
    stream[CLOSED_RESOLVE] = resolve;
    stream[CLOSED_REJECT]  = reject;
  });

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
    function fulfill() {
      if (stream._buffer.length === 0) {
        stream._state = 'writable';
        stream[WRITABLE_RESOLVE](undefined);
      }
      else {
        var data = stream._buffer.shift();
        stream._doNextWrite(data);
      }
    },
    function error(e)  { stream._error(e); }
  );
}

BaseWritableStream.prototype._error = function _error(error) {
  if (this._state !== 'closed' && this._state !== 'errored') {
    this[WRITABLE_REJECT](error);
    this[CLOSED_REJECT](error);
    for (var i = 0; i < this._buffer.length; i++) {
      this._buffer[i]._reject(error);
    }
    this._storedError = error;
    this._state = 'errored';
  }
};

BaseWritableStream.prototype._doClose = function _doClose() {
  var stream = this;

  this[WRITABLE_REJECT](new TypeError('stream has already been closed'));

  var closeResult;
  try {
    closeResult = Promise.cast(this._onClose());
  }
  catch (error) {
    this._error(error);
    return Promise.reject(error);
  }

  closeResult.then(
    function resolve() {
      stream._state = 'closed';
      stream[CLOSED_RESOLVE](undefined);
    },
    function reject(error) {
      stream._error(error);
    }
  );
};

BaseWritableStream.prototype._doNextWrite = function _doNextWrite(entry) {
  var stream = this;

  var type    = entry.type;
  var promise = entry.promise;
  var data    = entry.data;
  var resolve = entry._resolve;
  var reject  = entry._reject;

  if (type === 'close') {
    assert(this._state === 'closing', 'can\'t write final entry unless already closing');
    this._doClose();
    return;
  }

  assert(type === 'data', 'invalid entry type ' + type);

  this._currentWritePromise   = promise;
  this[CURRENT_WRITE_RESOLVE] = resolve;
  this[CURRENT_WRITE_REJECT]  = reject;

  function signalDone() {
    if (stream._currentWritePromise !== promise) return;
    stream._currentWritePromise = undefined;

    var entry;
    if (stream._state === 'waiting') {
      resolve(undefined);

      if (stream._buffer.length > 0) {
        entry = stream._buffer.shift();
        stream._doNextWrite(entry);
      }
      else {
        stream._state = 'writable';
        stream[WRITABLE_RESOLVE](undefined);
      }
    }
    else if (stream._state === 'closing') {
      resolve(undefined);

      if (stream._buffer.length > 0) {
        entry = stream._buffer.shift();
        stream._doNextWrite(entry);
      }
    }
  }

  try {
    this._onWrite(data, signalDone, this._error.bind(this));
  }
  catch (error) {
    this._error(error);
  }
};

BaseWritableStream.prototype.write = function write(data) {
  var stream = this;

  var resolver, rejecter;
  var promise = new Promise(function (resolve, reject) {
    resolver = resolve;
    rejecter = reject;
  });

  switch (this._state) {
    case 'writable':
      this._state = 'waiting';
      this._writablePromise = new Promise(function (resolve, reject) {
        stream[WRITABLE_RESOLVE] = resolve;
        stream[WRITABLE_REJECT] = reject;
      });
      this._doNextWrite({
        type     : 'data',
        promise  : promise,
        data     : data,
        _resolve : resolver,
        _reject  : rejecter
      });
      return promise;

    case 'waiting':
      this._buffer.push({
        type     : 'data',
        promise  : promise,
        data     : data,
        _resolve : resolver,
        _reject  : rejecter
      });
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

BaseWritableStream.prototype.close = function close() {
  switch (this._state) {
    case 'writable':
      this._state = 'closing';
      this._doClose();
      return this._closedPromise();

    case 'waiting':
      this._state = 'closing';

      this._buffer.push({
        type    : 'close',
        promise : undefined,
        data    : undefined
      });
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

BaseWritableStream.prototype.abort = function abort(r) {
  switch (this._state) {
    case 'closed':
      return Promise.resolve(undefined);
    case 'errored':
      return Promise.reject(this._storedError);
    default:
      this._error(reason);
      return promiseCall(this._onAbort);
  }
};

BaseWritableStream.prototype.wait = function wait() {
  return this._writablePromise;
};

module.exports = BaseWritableStream;
