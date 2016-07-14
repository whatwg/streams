'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrNoop, PromiseInvokeOrFallbackOrNoop, ValidateAndNormalizeQueuingStrategy,
        typeIsObject } = require('./helpers.js');
const { rethrowAssertionErrorRejection } = require('./utils.js');
const { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize, PeekQueueValue } = require('./queue-with-sizes.js');

class WritableStream {
  constructor(underlyingSink = {}, { size, highWaterMark } = {}) {
    // Temporary value. Never used. To be overwritten by the initializer code of the controller.
    this._state = 'writable';
    this._storedError = undefined;

    this._writer = undefined;

    this._writeRequests = [];

    // Initialize to undefined first because the constructor of the controller checks this
    // variable to validate the caller.
    this._writableStreamController = undefined;

    const type = underlyingSink.type;

    if (type !== undefined) {
      throw new RangeError('Invalid type is specified');
    }

    if (highWaterMark === undefined) {
      highWaterMark = 1;
    }

    this._writableStreamController = new WritableStreamDefaultController(this, underlyingSink, size, highWaterMark);
  }

  get locked() {
    if (IsWritableStream(this) === false) {
      throw CreateWritableStreamBrandCheckException('locked');
    }

    return IsWritableStreamLocked(this);
  }

  abort(reason) {
    if (IsWritableStream(this) === false) {
      return Promise.reject(CreateWritableStreamBrandCheckException('abort'));
    }

    if (IsWritableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot abort a stream that already has a reader'));
    }

    WritableStreamAbort(this, reason);
  }

  getWriter() {
    if (IsWritableStream(this) === false) {
      throw CreateWritableStreamBrandCheckException('getWriter');
    }

    return AcquireWritableStreamDefaultWriter(this);
  }
}

exports.WritableStream = WritableStream;

// Helper functions for the WritableStream.

function CreateWritableStreamBrandCheckException(name) {
  return new TypeError('WritableStream.prototype.' + name + ' can only be used on a WritableStream')
}

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

  assert(state === 'writable' || state === 'waiting' || state === 'closing');

  const writer = stream._writer;

  const error = new TypeError('Aborted');

  for (const writeRequest of stream._writeRequests) {
    writeRequest._reject(error);
  }

  if (writer !== undefined) {
    WritableStreamDefaultWriterClosedPromiseReject(writer, error);

    if (state === 'waiting') {
      WritableStreamDefaultWriterReadyPromiseResolve(writer, undefined);
    }
  }

  stream._state = 'errored';
  stream._storedError = error;

  return WritableStreamDefaultControllerAbort(stream._writableStreamController, reason);
}

// WritableStream API exposed for controllers.

function WritableStreamAddWriteRequest(stream) {
  const writer = stream._writer;
  assert(IsWritableStreamDefaultWriter(writer) === true);

  const state = stream._state;
  assert(state === 'writable' || state === 'waiting');

  const promise = new Promise((resolve, reject) => {
    const writeRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._writeRequests.push(writeRequest);
  });

  return promise;
}

function WritableStreamError(stream, e) {
  const state = stream._state;
  assert(state === 'writable' || state === 'waiting' || state === 'closing');

  const writeRequests = stream._writeRequests;
  while (writeRequests.length > 0) {
    const writeRequest = writeRequests.shift();
    writeRequest._reject(e);
  }

  const writer = stream._writer;

  if (writer !== undefined) {
    WritableStreamDefaultWriterClosedPromiseReject(writer, e);

    if (state === 'waiting') {
      WritableStreamDefaultWriterReadyPromiseResolve(writer, undefined);
    }
  }

  stream._state = 'errored';
  stream._storedError = e;
}

function WritableStreamFinishClose(stream) {
  assert(stream._state === 'closing');

  stream._state = 'closed';

  const writer = stream._writer;

  // writer cannot be released while close() is ongoing. So, we can assert that
  // there's an active writer.
  assert(writer !== undefined);

  WritableStreamDefaultWriterClosedPromiseResolve(writer);
}

function WritableStreamFulfillWriteRequest(stream) {
  assert(stream._writeRequests.length > 0);

  const writeRequest = stream._writeRequests.shift();
  writeRequest._resolve(undefined);
}

function WritableStreamUpdateBackpressure(stream, backpressure) {
  const state = stream._state;
  const writer = stream._writer;

  if (state === 'writable') {
    if (backpressure === false) {
      return;
    }

    stream._state = 'waiting';

    if (writer !== undefined) {
      WritableStreamDefaultWriterReadyPromiseReset(writer);
    }

    return;
  }

  assert(state === 'waiting');

  if (backpressure === true) {
    return;
  }

  stream._state = 'writable';

  if (writer !== undefined) {
    WritableStreamDefaultWriterReadyPromiseResolve(writer, undefined);
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

    if (state === 'writable' || state === 'waiting' || state === 'closing') {
      WritableStreamDefaultWriterClosedPromiseInitialize(this);
    } else {
      if (state === 'closed') {
        WritableStreamDefaultWriterClosedPromiseInitializeAsResolved(this, undefined);
      } else {
        assert(state === 'errored', 'state must be errored');

        WritableStreamDefaultWriterClosedPromiseInitializeAsRejected(this, stream._storedError);
      }
    }

    if (state === 'waiting') {
      WritableStreamDefaultWriterReadyPromiseInitialize(this);
    } else {
      WritableStreamDefaultWriterReadyPromiseInitializeAsResolved(this, undefined);
    }
  }

  get closed() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(CreateWritableStreamDefaultWriterBrandCheckException('closed'));
    }

    return this._closedPromise;
  }

  get desiredSize() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      throw CreateWritableStreamDefaultWriterBrandCheckException('desiredSize');
    }

    if (this._ownerWritableStream === undefined) {
      throw CreateWritableStreamDefaultWriterLockException('desiredSize');
    }

    return WritableStreamDefaultWriterGetDesiredSize(this)
  }

  get ready() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(CreateWritableStreamDefaultWriterBrandCheckException('ready'));
    }

    return this._readyPromise;
  }

  abort(reason) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(CreateWritableStreamDefaultWriterBrandCheckException('abort'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(CreateWritableStreamDefaultWriterLockException('abort'));
    }

    return WritableStreamDefaultWriterAbort(this, reason);
  }

  close() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(CreateWritableStreamDefaultWriterBrandCheckException('close'));
    }

    const stream = this._ownerWritableStream;

    if (stream === undefined) {
      return Promise.reject(CreateWritableStreamDefaultWriterLockException('close'));
    }

    if (stream._state === 'closing') {
      return Promise.reject(new TypeError('cannot close an already-closing stream'));
    }

    return WritableStreamDefaultWriterClose(this);
  }

  releaseLock() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      throw CreateWritableStreamDefaultWriterBrandCheckException('releaseLock');
    }

    const stream = this._ownerWritableStream;

    if (stream === undefined) {
      return undefined;
    }

    assert(stream._writer !== undefined);

    const state = stream._state;

    const releasedException = new TypeError('Writer was released and can no longer be used to monitor the stream\'s closedness');

    if (state === 'writable' || state === 'waiting' || state === 'closing') {
      WritableStreamDefaultWriterClosedPromiseReject(this, releasedException);
    } else {
      WritableStreamDefaultWriterClosedPromiseResetToRejected(this, releasedException);
    }

    if (state === 'waiting') {
      WritableStreamDefaultWriterReadyPromiseReject(this, releasedException);
    } else {
      WritableStreamDefaultWriterReadyPromiseResetToRejected(this, releasedException);
    }

    stream._writer = undefined;
    this._ownerWritableStream = undefined;
  }

  write(chunk) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(CreateWritableStreamDefaultWriterBrandCheckException('write'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(CreateWritableStreamDefaultWriterLockException('write to'));
    }

    if (this._ownerWritableStream._state === 'closing') {
      return Promise.reject(new TypeError('Cannot write to an already-closed stream'));
    }

    return WritableStreamDefaultWriterWrite(this, chunk);
  }
}

// Helper functions for the WritableStreamDefaultWriter.

function CreateWritableStreamDefaultWriterBrandCheckException(name) {
  return new TypeError('WritableStreamDefaultWriter.prototype.' + name + ' can only be used on a WritableStreamDefaultWriter');
}

function CreateWritableStreamDefaultWriterLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released writer');
}

function WritableStreamDefaultWriterClosedPromiseInitialize(writer) {
  writer._closedPromise = new Promise((resolve, reject) => {
    writer._closedPromise_resolve = resolve;
    writer._closedPromise_reject = reject;
  });
}

function WritableStreamDefaultWriterClosedPromiseInitializeAsRejected(writer, reason) {
  writer._closedPromise = Promise.reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterClosedPromiseInitializeAsResolved(writer, value) {
  writer._closedPromise = Promise.resolve(value);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterClosedPromiseReject(writer, reason) {
  assert(writer._closedPromise_resolve !== undefined);
  assert(writer._closedPromise_reject !== undefined);

  writer._closedPromise_reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterClosedPromiseResetToRejected(writer, reason) {
  assert(writer._closedPromise_resolve === undefined);
  assert(writer._closedPromise_reject === undefined);

  writer._closedPromise = Promise.reject(reason);
}

function WritableStreamDefaultWriterClosedPromiseResolve(writer) {
  assert(writer._closedPromise_resolve !== undefined);
  assert(writer._closedPromise_reject !== undefined);

  writer._closedPromise_resolve(undefined);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterReadyPromiseInitialize(writer) {
  writer._readyPromise = new Promise((resolve, reject) => {
    writer._readyPromise_resolve = resolve;
    writer._readyPromise_reject = reject;
  });
}

function WritableStreamDefaultWriterReadyPromiseInitializeAsResolved(writer) {
  writer._readyPromise = Promise.resolve(undefined);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}

function WritableStreamDefaultWriterReadyPromiseReject(writer, reason) {
  assert(writer._readyPromise_resolve !== undefined);
  assert(writer._readyPromise_reject !== undefined);

  writer._readyPromise_reject(reason);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
}

function WritableStreamDefaultWriterReadyPromiseReset(writer) {
  assert(writer._readyPromise_resolve === undefined);
  assert(writer._readyPromise_reject === undefined);

  writer._readyPromise = new Promise((resolve, reject) => {
    writer._readyPromise_resolve = resolve;
    writer._readyPromise_reject = reject;
  });
}

function WritableStreamDefaultWriterReadyPromiseResetToRejected(writer, reason) {
  assert(writer._readyPromise_resolve === undefined);
  assert(writer._readyPromise_reject === undefined);

  writer._readyPromise = Promise.reject(reason);
}

function WritableStreamDefaultWriterReadyPromiseResolve(writer, value) {
  assert(writer._readyPromise_resolve !== undefined);
  assert(writer._readyPromise_reject !== undefined);

  writer._readyPromise_resolve(value);
  writer._readyPromise_resolve = undefined;
  writer._readyPromise_reject = undefined;
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
    return Promise.reject(new TypeError(`The stream (in ${state} state) is not in the writable state and cannot be closed`));
  }

  assert(state === 'writable' || state === 'waiting');

  const promise = WritableStreamAddWriteRequest(stream);

  if (state === 'waiting') {
    WritableStreamDefaultWriterReadyPromiseResolve(writer, undefined);
  }

  stream._state = 'closing';

  WritableStreamDefaultControllerClose(stream._writableStreamController);

  return promise;
}

function WritableStreamDefaultWriterGetDesiredSize(writer) {
  const stream = writer._ownerWritableStream;

  if (stream._state === 'errored') {
    return null;
  }

  return WritableStreamDefaultControllerGetDesiredSize(stream._writableStreamController);
}

function WritableStreamDefaultWriterWrite(writer, chunk) {
  const stream = writer._ownerWritableStream;

  assert(stream !== undefined);

  const state = stream._state;
  if (state === 'closed' || state === 'errored') {
    return Promise.reject(new TypeError(`The stream (in ${state} state) is not in the writable state and cannot be written to`));
  }

  assert(state === 'writable' || state === 'waiting');

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
      throw new TypeError('WritableStreamDefaultController instances can only be created by the WritableStream constructor');
    }

    this._controlledWritableStream = stream;

    this._underlyingSink = underlyingSink;

    this._queue = [];
    this._started = false;
    this._writing = false;

    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(size, highWaterMark);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    WritableStreamDefaultControllerUpdateBackpressure(this);

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
      throw new TypeError('WritableStreamDefaultController.prototype.error can only be used on a WritableStreamDefaultController');
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
  controller._queue = [];

  const sinkAbortPromise = PromiseInvokeOrFallbackOrNoop(controller._underlyingSink, 'abort', [reason], 'close', []);
  return sinkAbortPromise.then(() => undefined);
}

function WritableStreamDefaultControllerClose(controller) {
  EnqueueValueWithSize(controller._queue, 'close', 0);
  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
}

function WritableStreamDefaultControllerGetDesiredSize(controller) {
  const queueSize = GetTotalQueueSize(controller._queue);
  return controller._strategyHWM - queueSize;
}

function WritableStreamDefaultControllerWrite(controller, chunk) {
  const stream = controller._controlledWritableStream;

  assert(stream._state === 'writable' || stream._state === 'waiting');

  let chunkSize = 1;

  if (controller._strategySize !== undefined) {
    try {
      chunkSize = controller._strategySize(chunk);
    } catch (chunkSizeE) {
      // TODO: Should we notify the sink of this error?
      WritableStreamDefaultControllerErrorIfNeeded(controller, chunkSizeE);
      return Promise.reject(chunkSizeE);
    }
  }

  const writeRecord = { chunk: chunk };

  try {
    EnqueueValueWithSize(controller._queue, writeRecord, chunkSize);
  } catch (enqueueE) {
    WritableStreamDefaultControllerErrorIfNeeded(controller, enqueueE);
    return Promise.reject(enqueueE);
  }

  const state = stream._state;
  if (state === 'writable' || state === 'waiting') {
    WritableStreamDefaultControllerUpdateBackpressure(controller);
  }

  WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);

  return;
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
  const state = controller._controlledWritableStream._state;
  if (state === 'closed' || state === 'errored') {
    return;
  }

  if (controller._started === false) {
    return;
  }

  if (controller._queue.length === 0) {
    return;
  }

  if (controller._writing === true) {
    return;
  }

  const writeRecord = PeekQueueValue(controller._queue);
  if (writeRecord === 'close') {
    WritableStreamDefaultControllerProcessClose(controller);
  } else {
    WritableStreamDefaultControllerProcessWrite(controller, writeRecord.chunk);
  }
}

function WritableStreamDefaultControllerErrorIfNeeded(controller, e) {
  const state = controller._controlledWritableStream._state;
  if (state === 'writable' || state === 'waiting' || state === 'closing') {
    WritableStreamDefaultControllerError(controller, e);
  }
}

function WritableStreamDefaultControllerProcessClose(controller) {
  const stream = controller._controlledWritableStream;

  assert(stream._state === 'closing', 'can\'t process final write record unless already closed');

  DequeueValue(controller._queue);
  assert(controller._queue.length === 0, 'queue must be empty once the final write record is dequeued');

  const sinkClosePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'close');
  sinkClosePromise.then(
    () => {
      if (stream._state !== 'closing') {
        return;
      }

      WritableStreamFulfillWriteRequest(stream);
      WritableStreamFinishClose(stream);
    },
    r => {
      WritableStreamDefaultControllerErrorIfNeeded(controller, r);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerProcessWrite(controller, chunk) {
  controller._writing = true;

  const sinkWritePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'write', [chunk]);
  sinkWritePromise.then(
    () => {
      const stream = controller._controlledWritableStream;
      const state = stream._state;
      if (state === 'errored' || state === 'closed') {
        return;
      }

      controller._writing = false;

      WritableStreamFulfillWriteRequest(stream);

      DequeueValue(controller._queue);
      if (state !== 'closing') {
        WritableStreamDefaultControllerUpdateBackpressure(controller);
      }

      WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    r => {
      WritableStreamDefaultControllerErrorIfNeeded(controller, r);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerUpdateBackpressure(controller) {
  const desiredSize = WritableStreamDefaultControllerGetDesiredSize(controller);
  const backpressure = desiredSize <= 0;
  WritableStreamUpdateBackpressure(controller._controlledWritableStream, backpressure);
}

// A client of WritableStreamDefaultController may use these functions directly to bypass state check.

function WritableStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledWritableStream;

  const state = stream._state;
  assert(state === 'writable' || state === 'waiting' || state === 'closing');

  controller._queue = [];

  WritableStreamError(stream, e);
}
