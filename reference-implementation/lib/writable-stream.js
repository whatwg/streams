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
    // them from being erroneously rejected on error. If a write() call is pending, the request is stored here.
    this._pendingWriteRequest = undefined;

    // The promise that was returned from writer.close(). Stored here because it may be fulfilled after the writer
    // has been detached.
    this._pendingCloseRequest = undefined;

    // The promise that was returned from writer.abort(). This may also be fulfilled after the writer has detached.
    this._pendingAbortRequest = undefined;

    const type = underlyingSink.type;

    if (type !== undefined) {
      throw new RangeError('Invalid type is specified');
    }

    this._writableStreamController = new WritableStreamDefaultController(this, underlyingSink, size, highWaterMark);
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
  WritableStreamDefaultWriterWrite
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
  const error = new TypeError('Aborted');
  if (stream._pendingAbortRequest !== undefined) {
    return Promise.reject(error);
  }

  assert(state === 'writable' || state === 'closing', 'state must be writable or closing');

  const controller = stream._writableStreamController;
  assert(controller !== undefined, 'controller must not be undefined');

  let readyPromiseIsPending = false;
  if (state === 'writable' &&
      WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
    readyPromiseIsPending = true;
  }

  if (controller._writing === false && controller._inClose === false) {
    if (stream._writer !== undefined) {
      WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(
          stream._writer, error, readyPromiseIsPending);
    }
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

  if (stream._writer !== undefined) {
    WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(stream._writer, error, readyPromiseIsPending);
  }

  return promise;
}

function WritableStreamFinishAbort(stream) {
  stream._state = 'errored';
  stream._storedError = new TypeError('Aborted');

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

function WritableStreamFinishPendingWrite(stream) {
  assert(stream._pendingWriteRequest !== undefined);
  stream._pendingWriteRequest._resolve(undefined);
  stream._pendingWriteRequest = undefined;

  const state = stream._state;

  let wasAborted = false;
  if (stream._pendingAbortRequest !== undefined) {
    wasAborted = true;
  }

  if (state === 'errored') {
    if (wasAborted === true) {
      stream._pendingAbortRequest._reject(stream._storedError);
      stream._pendingAbortRequest = undefined;
    }

    WritableStreamRejectPromisesInReactionToError(stream);

    return;
  }

  const controller = stream._writableStreamController;

  if (wasAborted === false) {
    return;
  }

  WritableStreamFinishAbort(stream, state);

  const abortRequest = stream._pendingAbortRequest;
  stream._pendingAbortRequest = undefined;
  const promise = WritableStreamDefaultControllerAbort(controller, abortRequest._reason);
  promise.then(
    abortRequest._resolve,
    abortRequest._reject
  );
}

function WritableStreamFinishPendingWriteWithError(stream, reason) {
  assert(stream._pendingWriteRequest !== undefined);
  stream._pendingWriteRequest._reject(reason);
  stream._pendingWriteRequest = undefined;

  const state = stream._state;

  let wasAborted = false;
  if (stream._pendingAbortRequest !== undefined) {
    wasAborted = true;
  }

  let readyPromiseIsPending = false;
  if (state === 'writable' && wasAborted === false &&
      WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
    readyPromiseIsPending = true;
  }

  if (wasAborted === true) {
    stream._pendingAbortRequest._reject(reason);
    stream._pendingAbortRequest = undefined;
  }

  if (state === 'errored') {
    WritableStreamRejectPromisesInReactionToError(stream);

    return;
  }

  stream._state = 'errored';
  stream._storedError = reason;

  if (wasAborted === false && stream._writer !== undefined) {
    WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(stream._writer, reason, readyPromiseIsPending);
  }

  WritableStreamRejectPromisesInReactionToError(stream);
}

function WritableStreamFinishPendingClose(stream) {
  assert(stream._pendingCloseRequest !== undefined);
  stream._pendingCloseRequest._resolve(undefined);
  stream._pendingCloseRequest = undefined;

  const state = stream._state;

  let wasAborted = false;
  if (stream._pendingAbortRequest !== undefined) {
    wasAborted = true;
  }

  if (state === 'errored') {
    if (wasAborted === true) {
      stream._pendingAbortRequest._reject(stream._storedError);
      stream._pendingAbortRequest = undefined;
    }

    WritableStreamRejectClosedPromiseIfAny(stream);

    return;
  }

  assert(state === 'closing');

  if (wasAborted === false) {
    const writer = stream._writer;
    if (writer !== undefined) {
      defaultWriterClosedPromiseResolve(writer);
    }
    stream._state = 'closed';
    return;
  }

  stream._pendingAbortRequest._resolve();
  stream._pendingAbortRequest = undefined;

  stream._state = 'errored';
  stream._storedError = new TypeError('Abort requested but closed successfully');

  WritableStreamRejectClosedPromiseIfAny(stream);
}

function WritableStreamFinishPendingCloseWithError(stream, reason) {
  assert(stream._pendingCloseRequest !== undefined);
  stream._pendingCloseRequest._reject(reason);
  stream._pendingCloseRequest = undefined;

  const state = stream._state;

  let wasAborted = false;
  if (stream._pendingAbortRequest !== undefined) {
    wasAborted = true;
  }

  let readyPromiseIsPending = false;
  if (state === 'writable' && wasAborted === false &&
      WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
    readyPromiseIsPending = true;
  }

  if (wasAborted === true) {
    stream._pendingAbortRequest._reject(reason);
    stream._pendingAbortRequest = undefined;
  }

  if (state === 'errored') {
    WritableStreamRejectClosedPromiseIfAny(stream);

    return;
  }

  assert(state === 'closing');

  stream._state = 'errored';
  stream._storedError = reason;

  if (wasAborted === false && stream._writer !== undefined) {
    WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(stream._writer, reason, readyPromiseIsPending);
  }

  WritableStreamRejectClosedPromiseIfAny(stream);
}

function WritableStreamMarkFirstWriteRequestPending(stream) {
  assert(stream._pendingWriteRequest === undefined, 'there must be no pending write request');
  assert(stream._writeRequests.length !== 0, 'writeRequests must not be empty');
  stream._pendingWriteRequest = stream._writeRequests.shift();
}

function WritableStreamRejectClosedPromiseIfAny(stream) {
  const writer = stream._writer;
  if (writer !== undefined) {
    defaultWriterClosedPromiseReject(writer, stream._storedError);
    writer._closedPromise.catch(() => {});
  }
}

function WritableStreamRejectPromisesInReactionToError(stream) {
  assert(stream._state === 'errored');

  const storedError = stream._storedError;
  for (const writeRequest of stream._writeRequests) {
    writeRequest._reject(storedError);
  }
  stream._writeRequests = [];

  if (stream._pendingCloseRequest !== undefined) {
    assert(stream._writableStreamController._inClose === false);
    stream._pendingCloseRequest._reject(storedError);
    stream._pendingCloseRequest = undefined;
  }

  WritableStreamRejectClosedPromiseIfAny(stream);
}

function WritableStreamUpdateBackpressure(stream, backpressure) {
  assert(stream._state === 'writable');

  const writer = stream._writer;
  if (writer === undefined) {
    return;
  }

  if (backpressure === true) {
    defaultWriterReadyPromiseReset(writer);
  } else {
    assert(backpressure === false);
    defaultWriterReadyPromiseResolve(writer);
  }
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

    if (state === 'writable' || state === 'closing') {
      defaultWriterClosedPromiseInitialize(this);
    } else if (state === 'closed') {
      defaultWriterClosedPromiseInitializeAsResolved(this);
    } else {
      assert(state === 'errored', 'state must be errored');

      defaultWriterClosedPromiseInitializeAsRejected(this, stream._storedError);
      this._closedPromise.catch(() => {});
    }

    if (state === 'writable' &&
        WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
      defaultWriterReadyPromiseInitialize(this);
    } else {
      defaultWriterReadyPromiseInitializeAsResolved(this, undefined);
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

    if (stream._state === 'closing') {
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

    const stream = this._ownerWritableStream;

    if (stream === undefined) {
      return Promise.reject(defaultWriterLockException('write to'));
    }

    if (stream._state === 'closing') {
      return Promise.reject(new TypeError('Cannot write to an already-closed stream'));
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
    return Promise.reject(new TypeError('Aborted'));
  }

  assert(state === 'writable');

  const promise = new Promise((resolve, reject) => {
    const closeRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._pendingCloseRequest = closeRequest;
  });

  if (WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
    defaultWriterReadyPromiseResolve(writer);
  }

  stream._state = 'closing';

  WritableStreamDefaultControllerClose(stream._writableStreamController);

  return promise;
}


function WritableStreamDefaultWriterCloseWithErrorPropagation(writer) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const state = stream._state;
  if (state === 'closing' || state === 'closed') {
    return Promise.resolve();
  }

  if (state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  assert(state === 'writable');

  return WritableStreamDefaultWriterClose(writer);
}

function WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(writer, error, isPending) {
  if (isPending === true) {
    defaultWriterReadyPromiseReject(writer, error);
  } else {
    defaultWriterReadyPromiseResetToRejected(writer, error);
  }
  writer._readyPromise.catch(() => {});
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

  const controller = stream._writableStreamController;
  if (state === 'writable' || state === 'closing' || controller._inClose === true || controller._writing === true) {
    defaultWriterClosedPromiseReject(writer, releasedError);
  } else {
    defaultWriterClosedPromiseResetToRejected(writer, releasedError);
  }
  writer._closedPromise.catch(() => {});

  let readyPromiseIsPending = false;
  if (state === 'writable' && stream._pendingAbortRequest === undefined &&
      WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
    readyPromiseIsPending = true;
  }
  WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(writer, releasedError, readyPromiseIsPending);

  stream._writer = undefined;
  writer._ownerWritableStream = undefined;
}

function WritableStreamDefaultWriterWrite(writer, chunk) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const state = stream._state;
  if (state === 'closed' || state === 'errored') {
    return Promise.reject(new TypeError(
      `The stream (in ${state} state) is not in the writable state and cannot be written to`));
  }
  if (stream._pendingAbortRequest !== undefined) {
    return Promise.reject(new TypeError('Aborted'));
  }

  assert(state === 'writable');

  const promise = WritableStreamAddWriteRequest(stream);

  WritableStreamDefaultControllerWrite(stream._writableStreamController, chunk);

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
    this._writing = false;
    this._inClose = false;

    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(size, highWaterMark);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    const backpressure = WritableStreamDefaultControllerGetBackpressure(this);
    if (backpressure === true) {
      WritableStreamUpdateBackpressure(stream, backpressure);
    }

    const controller = this;

    const startResult = InvokeOrNoop(underlyingSink, 'start', [this]);
    Promise.resolve(startResult).then(
      () => {
        controller._started = true;
        WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
      },
      r => {
        WritableStreamDefaultControllerErrorIfNeeded(controller, r);
      }
    )
    .catch(rethrowAssertionErrorRejection);
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

function WritableStreamDefaultControllerGetDesiredSize(controller) {
  return controller._strategyHWM - controller._queueTotalSize;
}

function WritableStreamDefaultControllerUpdateBackpressureIfNeeded(controller, oldBackpressure) {
  const stream = controller._controlledWritableStream;
  if (stream._state !== 'writable') {
    return;
  }

  const backpressure = WritableStreamDefaultControllerGetBackpressure(controller);
  if (oldBackpressure !== backpressure) {
    WritableStreamUpdateBackpressure(stream, backpressure);
  }
}

function WritableStreamDefaultControllerWrite(controller, chunk) {
  const stream = controller._controlledWritableStream;

  assert(stream._state === 'writable');

  let chunkSize = 1;

  if (controller._strategySize !== undefined) {
    const strategySize = controller._strategySize;
    try {
      chunkSize = strategySize(chunk);
    } catch (chunkSizeE) {
      // TODO: Should we notify the sink of this error?
      WritableStreamDefaultControllerErrorIfNeeded(controller, chunkSizeE);
      return;
    }
  }

  const writeRecord = { chunk };

  const oldBackpressure = WritableStreamDefaultControllerGetBackpressure(controller);

  try {
    EnqueueValueWithSize(controller, writeRecord, chunkSize);
  } catch (enqueueE) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, enqueueE);
    return;
  }

  WritableStreamDefaultControllerUpdateBackpressureIfNeeded(controller, oldBackpressure);

  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
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
  if (controller._controlledWritableStream._state === 'closed' ||
      controller._controlledWritableStream._state === 'errored') {
    return;
  }

  if (controller._started === false) {
    return;
  }

  if (controller._writing === true) {
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
  if (controller._controlledWritableStream._state === 'writable' ||
      controller._controlledWritableStream._state === 'closing') {
    WritableStreamDefaultControllerError(controller, e);
  }
}

function WritableStreamDefaultControllerProcessClose(controller) {
  const stream = controller._controlledWritableStream;

  assert(stream._state === 'closing', 'can\'t process final write record unless already closed');

  DequeueValue(controller);
  assert(controller._queue.length === 0, 'queue must be empty once the final write record is dequeued');

  controller._inClose = true;
  const sinkClosePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'close', [controller]);
  sinkClosePromise.then(
    () => {
      assert(controller._inClose === true);
      controller._inClose = false;
      assert(stream._state === 'closing' || stream._state === 'errored');

      WritableStreamFinishPendingClose(stream);
    },
    reason => {
      assert(controller._inClose === true);
      controller._inClose = false;

      WritableStreamFinishPendingCloseWithError(stream, reason);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerProcessWrite(controller, chunk) {
  controller._writing = true;

  const stream = controller._controlledWritableStream;

  WritableStreamMarkFirstWriteRequestPending(stream);

  const sinkWritePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'write', [chunk, controller]);
  sinkWritePromise.then(
    () => {
      assert(controller._writing === true);
      controller._writing = false;

      WritableStreamFinishPendingWrite(stream);

      const state = stream._state;
      if (state === 'errored') {
        return;
      }

      assert(state === 'closing' || state === 'writable');

      const oldBackpressure = WritableStreamDefaultControllerGetBackpressure(controller);
      DequeueValue(controller);
      WritableStreamDefaultControllerUpdateBackpressureIfNeeded(controller, oldBackpressure);

      WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    reason => {
      assert(controller._writing === true);
      controller._writing = false;

      const wasErrored = stream._state === 'errored';

      WritableStreamFinishPendingWriteWithError(stream, reason);

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

  assert(stream._state === 'writable' || stream._state === 'closing');

  const oldState = stream._state;

  stream._state = 'errored';
  stream._storedError = e;

  if (stream._pendingAbortRequest === undefined && stream._writer !== undefined) {
    let readyPromiseIsPending = false;
    if (oldState === 'writable' &&
        WritableStreamDefaultControllerGetBackpressure(stream._writableStreamController) === true) {
      readyPromiseIsPending = true;
    }
    WritableStreamDefaultWriterEnsureReadyPromiseRejectedWith(stream._writer, e, readyPromiseIsPending);
  }

  ResetQueue(controller);

  if (controller._writing === false && controller._inClose === false) {
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
