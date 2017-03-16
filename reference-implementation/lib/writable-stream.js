'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrNoop, ValidateAndNormalizeQueuingStrategy, typeIsObject } =
  require('./helpers.js');
const { rethrowAssertionErrorRejection } = require('./utils.js');
const { DequeueValue, EnqueueValueWithSize, PeekQueueValue, ResetQueue } = require('./queue-with-sizes.js');

class WritableStream {
  constructor(underlyingSink = {}, { size, highWaterMark = 1 } = {}) {
    this._state = 'writable';
    this._storedError = undefined;

    this._writer = undefined;

    // Initialize to undefined first because the constructor of the controller checks this
    // variable to validate the caller.
    this._writableStreamController = undefined;

    // This queue is placed here instead of the writer class in order to allow for passing a writer to the next data
    // producer without waiting for the queued writes to finish.
    this._writeRequests = [];

    // Write requests are removed from _writeRequests when write() is called on the underlying sink. This prevents
    // them from being erroneously rejected on error. If a write() call is in-flight, the request is stored here.
    this._inFlightWriteRequest = undefined;

    // The promise that was returned from writer.close(). Stored here because it may be fulfilled after the writer
    // has been detached.
    this._closeRequest = undefined;

    // Close request is removed from _closeRequest when close() is called on the underlying sink. This prevents it
    // from being erroneously rejected on error. If a close() call is in-flight, the request is stored here.
    this._inFlightCloseRequest = undefined;

    // The promise that was returned from writer.abort(). This may also be fulfilled after the writer has detached.
    this._pendingAbortRequest = undefined;

    // The backpressure signal set by the controller.
    this._backpressure = false;

    const type = underlyingSink.type;

    if (type !== undefined) {
      throw new RangeError('Invalid type is specified');
    }

    this._writableStreamController = new WritableStreamDefaultController(this, underlyingSink, size, highWaterMark);
    WritableStreamDefaultControllerStart(this._writableStreamController);
  }

  get locked() {
    if (IsWritableStream(this) === false) {
      throw streamBrandCheckException('locked');
    }

    return IsWritableStreamLocked(this);
  }

  abort(reason) {
    if (IsWritableStream(this) === false) {
      return Promise.reject(streamBrandCheckException('abort'));
    }

    if (IsWritableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot abort a stream that already has a writer'));
    }

    return WritableStreamAbort(this, reason);
  }

  getWriter() {
    if (IsWritableStream(this) === false) {
      throw streamBrandCheckException('getWriter');
    }

    return AcquireWritableStreamDefaultWriter(this);
  }
}

module.exports = {
  AcquireWritableStreamDefaultWriter,
  IsWritableStream,
  IsWritableStreamLocked,
  WritableStream,
  WritableStreamAbort,
  WritableStreamDefaultControllerError,
  WritableStreamDefaultWriterCloseWithErrorPropagation,
  WritableStreamDefaultWriterRelease,
  WritableStreamDefaultWriterWrite,
  WritableStreamCloseQueuedOrInFlight
};

// Abstract operations for the WritableStream.

function AcquireWritableStreamDefaultWriter(stream) {
  return new WritableStreamDefaultWriter(stream);
}

function IsWritableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_writableStreamController')) {
    return false;
  }

  return true;
}

function IsWritableStreamLocked(stream) {
  assert(IsWritableStream(stream) === true, 'IsWritableStreamLocked should only be used on known writable streams');

  if (stream._writer === undefined) {
    return false;
  }

  return true;
}

function WritableStreamAbort(stream, reason) {
  const state = stream._state;
  if (state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  assert(state === 'writable', 'state must be writable');

  const error = new TypeError('Requested to abort');
  if (stream._pendingAbortRequest !== undefined) {
    return Promise.reject(error);
  }

  const controller = stream._writableStreamController;
  assert(controller !== undefined, 'controller must not be undefined');

  const writer = stream._writer;
  if (writer !== undefined) {
    if (WritableStreamCloseQueuedOrInFlight(stream) === false && stream._backpressure === true) {
      defaultWriterReadyPromiseReject(writer, error);
    } else {
      defaultWriterReadyPromiseResetToRejected(writer, error);
    }
    writer._readyPromise.catch(() => {});
  }

  if (WritableStreamHasOperationMarkedInFlight(stream) === false && controller._started === true) {
    WritableStreamFinishAbort(stream);
    return WritableStreamDefaultControllerAbort(controller, reason);
  }

  const promise = new Promise((resolve, reject) => {
    stream._pendingAbortRequest = {
      _resolve: resolve,
      _reject: reject,
      _reason: reason
    };
  });

  return promise;
}

function WritableStreamFinishAbort(stream) {
  const error = new TypeError('Aborted');

  stream._state = 'errored';
  stream._storedError = error;

  WritableStreamRejectPromisesInReactionToError(stream);
}

// WritableStream API exposed for controllers.

function WritableStreamAddWriteRequest(stream) {
  assert(IsWritableStreamLocked(stream) === true);
  assert(stream._state === 'writable');

  const promise = new Promise((resolve, reject) => {
    const writeRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._writeRequests.push(writeRequest);
  });

  return promise;
}

function WritableStreamFinishAbortAndIssuePendingAbortRequest(stream) {
  WritableStreamFinishAbort(stream);

  const abortRequest = stream._pendingAbortRequest;
  stream._pendingAbortRequest = undefined;
  const promise = WritableStreamDefaultControllerAbort(stream._writableStreamController, abortRequest._reason);
  promise.then(
    abortRequest._resolve,
    abortRequest._reject
  );
}

function WritableStreamFinishInFlightWrite(stream) {
  assert(stream._inFlightWriteRequest !== undefined);
  stream._inFlightWriteRequest._resolve(undefined);
  stream._inFlightWriteRequest = undefined;

  const state = stream._state;

  if (state === 'errored') {
    WritableStreamFinishInFlightWriteInErroredState(stream);
    return;
  }

  assert(state === 'writable');

  if (stream._pendingAbortRequest === undefined) {
    return;
  }

  WritableStreamFinishAbortAndIssuePendingAbortRequest(stream);
}

function WritableStreamFinishInFlightWriteInErroredState(stream) {
  WritableStreamRejectPendingAbortRequestIfNeeded(stream);
  WritableStreamRejectPromisesInReactionToError(stream);
}

function WritableStreamFinishInFlightWriteWithError(stream, reason) {
  assert(stream._inFlightWriteRequest !== undefined);
  stream._inFlightWriteRequest._reject(reason);
  stream._inFlightWriteRequest = undefined;

  const state = stream._state;

  if (state === 'errored') {
    WritableStreamFinishInFlightWriteInErroredState(stream);
    return;
  }

  assert(state === 'writable');

  stream._state = 'errored';
  stream._storedError = reason;

  if (stream._pendingAbortRequest === undefined) {
    const writer = stream._writer;
    if (writer !== undefined) {
      if (WritableStreamCloseQueuedOrInFlight(stream) === false && stream._backpressure === true) {
        defaultWriterReadyPromiseReject(writer, reason);
      } else {
        defaultWriterReadyPromiseResetToRejected(writer, reason);
      }
      writer._readyPromise.catch(() => {});
    }
  } else {
    stream._pendingAbortRequest._reject(reason);
    stream._pendingAbortRequest = undefined;
  }

  WritableStreamRejectPromisesInReactionToError(stream);
}

function WritableStreamFinishInFlightClose(stream) {
  assert(stream._inFlightCloseRequest !== undefined);
  stream._inFlightCloseRequest._resolve(undefined);
  stream._inFlightCloseRequest = undefined;

  const state = stream._state;

  if (state === 'errored') {
    WritableStreamFinishInFlightCloseInErroredState(stream);
    return;
  }

  assert(state === 'writable');

  if (stream._pendingAbortRequest === undefined) {
    stream._state = 'closed';

    const writer = stream._writer;
    if (writer !== undefined) {
      defaultWriterClosedPromiseResolve(writer);
    }

    return;
  }

  stream._pendingAbortRequest._resolve();
  stream._pendingAbortRequest = undefined;

  const error = new TypeError('Requested to abort but has been closed');

  stream._state = 'errored';
  stream._storedError = error;

  WritableStreamRejectClosedPromiseInReactionToError(stream);
}

function WritableStreamFinishInFlightCloseInErroredState(stream) {
  WritableStreamRejectPendingAbortRequestIfNeeded(stream);
  WritableStreamRejectClosedPromiseInReactionToError(stream);
}

function WritableStreamFinishInFlightCloseWithError(stream, reason) {
  assert(stream._inFlightCloseRequest !== undefined);
  stream._inFlightCloseRequest._reject(reason);
  stream._inFlightCloseRequest = undefined;

  const state = stream._state;

  if (state === 'errored') {
    WritableStreamFinishInFlightCloseInErroredState(stream);
    return;
  }

  assert(state === 'writable');

  stream._state = 'errored';
  stream._storedError = reason;

  if (stream._pendingAbortRequest === undefined) {
    const writer = stream._writer;
    if (writer !== undefined) {
      defaultWriterReadyPromiseResetToRejected(writer, reason);
      writer._readyPromise.catch(() => {});
    }
  } else {
    stream._pendingAbortRequest._reject(reason);
    stream._pendingAbortRequest = undefined;
  }

  WritableStreamRejectClosedPromiseInReactionToError(stream);
}

function WritableStreamCloseQueuedOrInFlight(stream) {
  if (stream._closeRequest === undefined && stream._inFlightCloseRequest === undefined) {
    return false;
  }

  return true;
}

function WritableStreamHasOperationMarkedInFlight(stream) {
  if (stream._inFlightWriteRequest === undefined && stream._inFlightCloseRequest === undefined) {
    return false;
  }

  return true;
}

function WritableStreamMarkCloseRequestInFlight(stream) {
  assert(stream._inFlightCloseRequest === undefined);
  assert(stream._closeRequest !== undefined);
  stream._inFlightCloseRequest = stream._closeRequest;
  stream._closeRequest = undefined;
}

function WritableStreamMarkFirstWriteRequestInFlight(stream) {
  assert(stream._inFlightWriteRequest === undefined, 'there must be no pending write request');
  assert(stream._writeRequests.length !== 0, 'writeRequests must not be empty');
  stream._inFlightWriteRequest = stream._writeRequests.shift();
}

function WritableStreamRejectClosedPromiseInReactionToError(stream) {
  const writer = stream._writer;
  if (writer !== undefined) {
    defaultWriterClosedPromiseReject(writer, stream._storedError);
    writer._closedPromise.catch(() => {});
  }
}

function WritableStreamRejectPendingAbortRequestIfNeeded(stream) {
  if (stream._pendingAbortRequest !== undefined) {
    stream._pendingAbortRequest._reject(stream._storedError);
    stream._pendingAbortRequest = undefined;
  }
}

function WritableStreamRejectPromisesInReactionToError(stream) {
  const storedError = stream._storedError;

  for (const writeRequest of stream._writeRequests) {
    writeRequest._reject(storedError);
  }
  stream._writeRequests = [];

  if (stream._closeRequest !== undefined) {
    assert(stream._inFlightCloseRequest === undefined);

    stream._closeRequest._reject(storedError);
    stream._closeRequest = undefined;
  }

  WritableStreamRejectClosedPromiseInReactionToError(stream);
}

function WritableStreamUpdateBackpressure(stream, backpressure) {
  assert(stream._state === 'writable');
  assert(WritableStreamCloseQueuedOrInFlight(stream) === false);

  const writer = stream._writer;
  if (writer !== undefined && backpressure !== stream._backpressure) {
    if (backpressure === true) {
      defaultWriterReadyPromiseReset(writer);
    } else {
      assert(backpressure === false);

      defaultWriterReadyPromiseResolve(writer);
    }
  }

  stream._backpressure = backpressure;
}

class WritableStreamDefaultWriter {
  constructor(stream) {
    if (IsWritableStream(stream) === false) {
      throw new TypeError('WritableStreamDefaultWriter can only be constructed with a WritableStream instance');
    }
    if (IsWritableStreamLocked(stream) === true) {
      throw new TypeError('This stream has already been locked for exclusive writing by another writer');
    }

    this._ownerWritableStream = stream;
    stream._writer = this;

    const state = stream._state;

    if (state === 'writable') {
      if (stream._pendingAbortRequest !== undefined) {
        const error = new TypeError('Requested to abort');
        defaultWriterReadyPromiseInitializeAsRejected(this, error);
        this._readyPromise.catch(() => {});
      } else if (WritableStreamCloseQueuedOrInFlight(stream) === false && stream._backpressure === true) {
        defaultWriterReadyPromiseInitialize(this);
      } else {
        defaultWriterReadyPromiseInitializeAsResolved(this);
      }

      defaultWriterClosedPromiseInitialize(this);
    } else if (state === 'closed') {
      defaultWriterReadyPromiseInitializeAsResolved(this);
      defaultWriterClosedPromiseInitializeAsResolved(this);
    } else {
      assert(state === 'errored', 'state must be errored');

      const storedError = stream._storedError;
      defaultWriterReadyPromiseInitializeAsRejected(this, storedError);
      this._readyPromise.catch(() => {});
      defaultWriterClosedPromiseInitializeAsRejected(this, storedError);
      this._closedPromise.catch(() => {});
    }
  }

  get closed() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(defaultWriterBrandCheckException('closed'));
    }

    return this._closedPromise;
  }

  get desiredSize() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      throw defaultWriterBrandCheckException('desiredSize');
    }

    if (this._ownerWritableStream === undefined) {
      throw defaultWriterLockException('desiredSize');
    }

    return WritableStreamDefaultWriterGetDesiredSize(this);
  }

  get ready() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(defaultWriterBrandCheckException('ready'));
    }

    return this._readyPromise;
  }

  abort(reason) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(defaultWriterBrandCheckException('abort'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(defaultWriterLockException('abort'));
    }

    return WritableStreamDefaultWriterAbort(this, reason);
  }

  close() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(defaultWriterBrandCheckException('close'));
    }

    const stream = this._ownerWritableStream;

    if (stream === undefined) {
      return Promise.reject(defaultWriterLockException('close'));
    }

    if (WritableStreamCloseQueuedOrInFlight(stream) === true) {
      return Promise.reject(new TypeError('cannot close an already-closing stream'));
    }

    return WritableStreamDefaultWriterClose(this);
  }

  releaseLock() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      throw defaultWriterBrandCheckException('releaseLock');
    }

    const stream = this._ownerWritableStream;

    if (stream === undefined) {
      return;
    }

    assert(stream._writer !== undefined);

    WritableStreamDefaultWriterRelease(this);
  }

  write(chunk) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(defaultWriterBrandCheckException('write'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(defaultWriterLockException('write to'));
    }

    return WritableStreamDefaultWriterWrite(this, chunk);
  }
}

// Abstract operations for the WritableStreamDefaultWriter.

function IsWritableStreamDefaultWriter(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_ownerWritableStream')) {
    return false;
  }

  return true;
}

// A client of WritableStreamDefaultWriter may use these functions directly to bypass state check.

function WritableStreamDefaultWriterAbort(writer, reason) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  return WritableStreamAbort(stream, reason);
}

function WritableStreamDefaultWriterClose(writer) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const state = stream._state;
  if (state === 'closed' || state === 'errored') {
    return Promise.reject(new TypeError(
      `The stream (in ${state} state) is not in the writable state and cannot be closed`));
  }
  if (stream._pendingAbortRequest !== undefined) {
    return Promise.reject(new TypeError('Requested to abort'));
  }

  assert(state === 'writable');
  assert(WritableStreamCloseQueuedOrInFlight(stream) === false);

  const promise = new Promise((resolve, reject) => {
    const closeRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._closeRequest = closeRequest;
  });

  if (stream._backpressure === true) {
    defaultWriterReadyPromiseResolve(writer);
  }

  WritableStreamDefaultControllerClose(stream._writableStreamController);

  return promise;
}


function WritableStreamDefaultWriterCloseWithErrorPropagation(writer) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const state = stream._state;
  if (WritableStreamCloseQueuedOrInFlight(stream) === true || state === 'closed') {
    return Promise.resolve();
  }

  if (state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  assert(state === 'writable');

  return WritableStreamDefaultWriterClose(writer);
}

function WritableStreamDefaultWriterGetDesiredSize(writer) {
  const stream = writer._ownerWritableStream;
  const state = stream._state;

  if (state === 'errored' || stream._pendingAbortRequest !== undefined) {
    return null;
  }

  if (state === 'closed') {
    return 0;
  }

  return WritableStreamDefaultControllerGetDesiredSize(stream._writableStreamController);
}

function WritableStreamDefaultWriterRelease(writer) {
  const stream = writer._ownerWritableStream;
  assert(stream !== undefined);
  assert(stream._writer === writer);

  const releasedError = new TypeError(
    'Writer was released and can no longer be used to monitor the stream\'s closedness');
  const state = stream._state;

  if (state === 'writable' && WritableStreamCloseQueuedOrInFlight(stream) === false &&
      stream._pendingAbortRequest === undefined && stream._backpressure === true) {
    defaultWriterReadyPromiseReject(writer, releasedError);
  } else {
    defaultWriterReadyPromiseResetToRejected(writer, releasedError);
  }
  writer._readyPromise.catch(() => {});

  if (state === 'writable' || WritableStreamHasOperationMarkedInFlight(stream) === true) {
    defaultWriterClosedPromiseReject(writer, releasedError);
  } else {
    defaultWriterClosedPromiseResetToRejected(writer, releasedError);
  }
  writer._closedPromise.catch(() => {});

  stream._writer = undefined;
  writer._ownerWritableStream = undefined;
}

function WritableStreamDefaultWriterWrite(writer, chunk) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const controller = stream._writableStreamController;

  const chunkSize = WritableStreamDefaultControllerGetChunkSize(controller, chunk);

  if (stream !== writer._ownerWritableStream) {
    return Promise.reject(defaultWriterLockException('write to'));
  }

  const state = stream._state;
  if (state !== 'writable' || WritableStreamCloseQueuedOrInFlight(stream) === true) {
    return Promise.reject(new TypeError(
      `The stream (in ${state} state) is not in the writable state and cannot be written to`));
  }
  if (stream._pendingAbortRequest !== undefined) {
    return Promise.reject(new TypeError('Requested to abort'));
  }

  const promise = WritableStreamAddWriteRequest(stream);

  WritableStreamDefaultControllerWrite(controller, chunk, chunkSize);

  return promise;
}

class WritableStreamDefaultController {
  constructor(stream, underlyingSink, size, highWaterMark) {
    if (IsWritableStream(stream) === false) {
      throw new TypeError('WritableStreamDefaultController can only be constructed with a WritableStream instance');
    }

    if (stream._writableStreamController !== undefined) {
      throw new TypeError(
        'WritableStreamDefaultController instances can only be created by the WritableStream constructor');
    }

    this._controlledWritableStream = stream;

    this._underlyingSink = underlyingSink;

    // Need to set the slots so that the assert doesn't fire. In the spec the slots already exist implicitly.
    this._queue = undefined;
    this._queueTotalSize = undefined;
    ResetQueue(this);

    this._started = false;

    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(size, highWaterMark);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    const backpressure = WritableStreamDefaultControllerGetBackpressure(this);
    WritableStreamUpdateBackpressure(stream, backpressure);
  }

  error(e) {
    if (IsWritableStreamDefaultController(this) === false) {
      throw new TypeError(
        'WritableStreamDefaultController.prototype.error can only be used on a WritableStreamDefaultController');
    }

    const state = this._controlledWritableStream._state;
    if (state === 'closed' || state === 'errored') {
      throw new TypeError(`The stream is ${state} and so cannot be errored`);
    }

    WritableStreamDefaultControllerError(this, e);
  }
}

// Abstract operations implementing interface required by the WritableStream.

function WritableStreamDefaultControllerAbort(controller, reason) {
  ResetQueue(controller);
  const sinkAbortPromise = PromiseInvokeOrNoop(controller._underlyingSink, 'abort', [reason]);
  return sinkAbortPromise.then(() => undefined);
}

function WritableStreamDefaultControllerClose(controller) {
  EnqueueValueWithSize(controller, 'close', 0);
  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function WritableStreamDefaultControllerGetChunkSize(controller, chunk) {
  const strategySize = controller._strategySize;

  if (strategySize === undefined) {
    return 1;
  }

  try {
    return strategySize(chunk);
  } catch (chunkSizeE) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, chunkSizeE);
    return 1;
  }
}

function WritableStreamDefaultControllerGetDesiredSize(controller) {
  return controller._strategyHWM - controller._queueTotalSize;
}

function WritableStreamDefaultControllerWrite(controller, chunk, chunkSize) {
  const writeRecord = { chunk };

  try {
    EnqueueValueWithSize(controller, writeRecord, chunkSize);
  } catch (enqueueE) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, enqueueE);
    return;
  }

  const stream = controller._controlledWritableStream;
  if (WritableStreamCloseQueuedOrInFlight(stream) === false) {
    const backpressure = WritableStreamDefaultControllerGetBackpressure(controller);
    WritableStreamUpdateBackpressure(stream, backpressure);
  }

  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function WritableStreamDefaultControllerStart(controller) {
  const startResult = InvokeOrNoop(controller._underlyingSink, 'start', [controller]);
  const stream = controller._controlledWritableStream;

  Promise.resolve(startResult).then(
    () => {
      controller._started = true;

      const state = stream._state;
      if (state === 'errored') {
        WritableStreamRejectPendingAbortRequestIfNeeded(stream);
        return;
      }

      if (stream._pendingAbortRequest === undefined) {
        WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
        return;
      }

      WritableStreamFinishAbortAndIssuePendingAbortRequest(stream);
    },
    r => {
      const state = stream._state;
      assert(state === 'writable' || state === 'errored');
      WritableStreamDefaultControllerErrorIfNeeded(controller, r);
      WritableStreamRejectPendingAbortRequestIfNeeded(stream);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

// Abstract operations for the WritableStreamDefaultController.

function IsWritableStreamDefaultController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingSink')) {
    return false;
  }

  return true;
}

function WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller) {
  const stream = controller._controlledWritableStream;
  const state = stream._state;

  if (state === 'closed' || state === 'errored') {
    return;
  }

  if (controller._started === false) {
    return;
  }

  if (stream._inFlightWriteRequest !== undefined) {
    return;
  }

  if (controller._queue.length === 0) {
    return;
  }

  const writeRecord = PeekQueueValue(controller);
  if (writeRecord === 'close') {
    WritableStreamDefaultControllerProcessClose(controller);
  } else {
    WritableStreamDefaultControllerProcessWrite(controller, writeRecord.chunk);
  }
}

function WritableStreamDefaultControllerErrorIfNeeded(controller, e) {
  if (controller._controlledWritableStream._state === 'writable') {
    WritableStreamDefaultControllerError(controller, e);
  }
}

function WritableStreamDefaultControllerProcessClose(controller) {
  const stream = controller._controlledWritableStream;

  WritableStreamMarkCloseRequestInFlight(stream);

  DequeueValue(controller);
  assert(controller._queue.length === 0, 'queue must be empty once the final write record is dequeued');

  const sinkClosePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'close', [controller]);
  sinkClosePromise.then(
    () => {
      WritableStreamFinishInFlightClose(stream);
    },
    reason => {
      WritableStreamFinishInFlightCloseWithError(stream, reason);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerProcessWrite(controller, chunk) {
  const stream = controller._controlledWritableStream;

  WritableStreamMarkFirstWriteRequestInFlight(stream);

  const sinkWritePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'write', [chunk, controller]);
  sinkWritePromise.then(
    () => {
      WritableStreamFinishInFlightWrite(stream);

      const state = stream._state;
      if (state === 'errored') {
        return;
      }

      assert(state === 'writable');

      DequeueValue(controller);

      if (WritableStreamCloseQueuedOrInFlight(stream) === false) {
        const backpressure = WritableStreamDefaultControllerGetBackpressure(controller);
        WritableStreamUpdateBackpressure(stream, backpressure);
      }

      WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    reason => {
      let wasErrored = false;
      if (stream._state === 'errored') {
        wasErrored = true;
      }

      WritableStreamFinishInFlightWriteWithError(stream, reason);

      assert(stream._state === 'errored');
      if (wasErrored === false) {
        controller._queue = [];
      }
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerGetBackpressure(controller) {
  const desiredSize = WritableStreamDefaultControllerGetDesiredSize(controller);
  return desiredSize <= 0;
}

// A client of WritableStreamDefaultController may use these functions directly to bypass state check.

function WritableStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledWritableStream;

  assert(stream._state === 'writable');

  stream._state = 'errored';
  stream._storedError = e;

  const writer = stream._writer;
  if (stream._pendingAbortRequest === undefined && writer !== undefined) {
    if (WritableStreamCloseQueuedOrInFlight(stream) === false && stream._backpressure === true) {
      defaultWriterReadyPromiseReject(writer, e);
    } else {
      defaultWriterReadyPromiseResetToRejected(writer, e);
    }
    writer._readyPromise.catch(() => {});
  }

  ResetQueue(controller);

  if (WritableStreamHasOperationMarkedInFlight(stream) === false) {
    WritableStreamRejectPromisesInReactionToError(stream);
  }
}

// Helper functions for the WritableStream.

function streamBrandCheckException(name) {
  return new TypeError(`WritableStream.prototype.${name} can only be used on a WritableStream`);
}

// Helper functions for the WritableStreamDefaultWriter.

function defaultWriterBrandCheckException(name) {
  return new TypeError(
    `WritableStreamDefaultWriter.prototype.${name} can only be used on a WritableStreamDefaultWriter`);
}

function defaultWriterLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released writer');
}

function defaultWriterClosedPromiseInitialize(writer) {
  writer._closedPromise = new Promise((resolve, reject) => {
    writer._closedPromise_resolve = resolve;
    writer._closedPromise_reject = reject;
  });
}

function defaultWriterClosedPromiseInitializeAsRejected(writer, reason) {
  writer._closedPromise = Promise.reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function defaultWriterClosedPromiseInitializeAsResolved(writer) {
  writer._closedPromise = Promise.resolve(undefined);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function defaultWriterClosedPromiseReject(writer, reason) {
  assert(writer._closedPromise_resolve !== undefined);
  assert(writer._closedPromise_reject !== undefined);

  writer._closedPromise_reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function defaultWriterClosedPromiseResetToRejected(writer, reason) {
  assert(writer._closedPromise_resolve === undefined);
  assert(writer._closedPromise_reject === undefined);

  writer._closedPromise = Promise.reject(reason);
}

function defaultWriterClosedPromiseResolve(writer) {
  assert(writer._closedPromise_resolve !== undefined);
  assert(writer._closedPromise_reject !== undefined);

  writer._closedPromise_resolve(undefined);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function defaultWriterReadyPromiseInitialize(writer) {
  writer._readyPromise = new Promise((resolve, reject) => {
    writer._readyPromise_resolve = resolve;
    writer._readyPromise_reject = reject;
  });
}

function defaultWriterReadyPromiseInitializeAsRejected(writer, reason) {
  writer._readyPromise = Promise.reject(reason);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}

function defaultWriterReadyPromiseInitializeAsResolved(writer) {
  writer._readyPromise = Promise.resolve(undefined);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}

function defaultWriterReadyPromiseReject(writer, reason) {
  assert(writer._readyPromise_resolve !== undefined);
  assert(writer._readyPromise_reject !== undefined);

  writer._readyPromise_reject(reason);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}

function defaultWriterReadyPromiseReset(writer) {
  assert(writer._readyPromise_resolve === undefined);
  assert(writer._readyPromise_reject === undefined);

  writer._readyPromise = new Promise((resolve, reject) => {
    writer._readyPromise_resolve = resolve;
    writer._readyPromise_reject = reject;
  });
}

function defaultWriterReadyPromiseResetToRejected(writer, reason) {
  assert(writer._readyPromise_resolve === undefined);
  assert(writer._readyPromise_reject === undefined);

  writer._readyPromise = Promise.reject(reason);
}

function defaultWriterReadyPromiseResolve(writer) {
  assert(writer._readyPromise_resolve !== undefined);
  assert(writer._readyPromise_reject !== undefined);

  writer._readyPromise_resolve(undefined);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}
