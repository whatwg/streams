'use strict';
const assert = require('assert');
const { InvokeOrNoop, PromiseInvokeOrNoop, PromiseInvokeOrFallbackOrNoop, ValidateAndNormalizeQueuingStrategy,
        typeIsObject } = require('./helpers.js');
const { rethrowAssertionErrorRejection } = require('./utils.js');
const { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize, PeekQueueValue } = require('./queue-with-sizes.js');

class WritableStream {
  constructor(underlyingSink = {}, { size, highWaterMark } = {}) {
    this._state = 'writable';

    this._writer = undefined;
    this._storedError = undefined;

    // Initialize to undefined first because the constructor of the controller checks this
    // variable to validate the caller.
    this._writableStreamController = undefined;
    const type = underlyingSink.type;
    if (type === undefined) {
      if (highWaterMark === undefined) {
        highWaterMark = 1;
      }
      this._writableStreamController = new WritableStreamDefaultController(this, underlyingSink, size, highWaterMark);
    } else {
      throw new RangeError('Invalid type is specified');
    }
  }

  get locked() {
    if (IsWritableStream(this) === false) {
      throw new TypeError('WritableStream.prototype.locked can only be used on a WritableStream');
    }

    return IsWritableStreamLocked(this);
  }

  abort(reason) {
    if (IsWritableStream(this) === false) {
      return Promise.reject(new TypeError('WritableStream.prototype.abort can only be used on a WritableStream'));
    }

    if (IsWritableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot abort a stream that already has a reader'));
    }

    WritableStreamAbort(this, reason);
  }

  getWriter() {
    if (IsWritableStream(this) === false) {
      throw new TypeError('WritableStream.prototype.getWriter can only be used on a WritableStream');
    }

    return AcquireWritableStreamDefaultWriter(this);
  }
}

exports.WritableStream = WritableStream;

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

  stream._state = 'closed';

  const writer = stream._writer;

  if (writer !== undefined) {
    WritableStreamDefaultWriterResolveClosedPromise(writer);
    WritableStreamDefaultWriterClearPendingWriteRequests(writer);
    WritableStreamDefaultWriterUpdateBackpressure(writer, true);
  }

  const sinkAbortPromise = WritableStreamDefaultControllerAbort(stream._writableStreamController, reason);
  return sinkAbortPromise.then(() => undefined);
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

    writer._writeRequests.push(writeRequest);
  });

  return promise;
}

function WritableStreamError(stream, e) {
  const state = stream._state;
  assert(state === 'writable' || state === 'waiting' || state === 'closing');

  stream._state = 'errored';
  stream._storedError = e;

  const writer = stream._writer;

  if (writer === undefined) {
    return;
  }

  WritableStreamDefaultWriterRejectClosedPromise(writer, e);
  WritableStreamDefaultWriterRejectPendingWriteRequests(writer, e);
  WritableStreamDefaultWriterUpdateBackpressure(writer, true);
}

function WritableStreamFinishClose(stream) {
  assert(stream._state === 'closing');

  stream._state = 'closed';

  const writer = stream._writer;

  // writer cannot be released while close() is ongoing. So, we can assert that
  // there's an active writer.
  assert(writer !== undefined);

  WritableStreamDefaultWriterResolveClosedPromise(writer);
}

function WritableStreamFulfillWriteRequest(stream) {
  const writer = stream._writer;

  assert(writer._writeRequests.length > 0);

  const writeRequest = writer._writeRequests.shift();
  writeRequest._resolve(undefined);
}

function WritableStreamUpdateBackpressure(stream, backpressure) {
  assert(stream._state === 'writable' || stream._state === 'waiting');

  if (backpressure) {
    stream._state = 'waiting';
  } else {
    stream._state = 'writable';
  }

  const writer = stream._writer;
  if (writer !== undefined) {
    WritableStreamDefaultWriterUpdateBackpressure(writer, backpressure);
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

    // A writer cannot be released while close is ongoing. So, a writer can
    // never be instantiated for a closing stream.
    assert(state !== 'closing');

    if (state === 'writable' || state === 'waiting') {
      this._closedPromise = new Promise((resolve, reject) => {
        this._closedPromise_resolve = resolve;
        this._closedPromise_reject = reject;
      });
    } else {
      if (state === 'closed') {
        this._closedPromise = Promise.resolve(undefined);
        this._closedPromise_resolve = undefined;
        this._closedPromise_reject = undefined;
      } else {
        assert(state === 'errored', 'state must be errored');

        WritableStreamDefaultWriterInitializeClosedPromiseAsRejected(this, stream._storedError);
      }
    }

    if (state === 'writable') {
      this._readyPromise = Promise.resolve(undefined);
      this._readyPromise_resolve = undefined;
    } else {
      this._readyPromise = new Promise((resolve, reject) => {
        this._readyPromise_resolve = resolve;
      });
    }

    this._closeRequested = false;
    this._writeRequests = [];
  }

  get closed() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.closed can only be used on a WritableStreamDefaultWriter'));
    }

    return this._closedPromise;
  }

  get desiredSize() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.desiredSize can only be used on a WritableStreamDefaultWriter'));
    }

    return WritableStreamDefaultWriterGetDesiredSize(this)
  }

  get ready() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.ready can only be used on a WritableStreamDefaultWriter'));
    }

    return this._readyPromise;
  }

  abort(reason) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.abort can only be used on a WritableStreamDefaultWriter'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(new TypeError('Cannot abort a stream using a released writer'));
    }

    return WritableStreamDefaultWriterAbort(this, reason);
  }

  close() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.close can only be used on a WritableStreamDefaultWriter'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(new TypeError('Cannot close a stream using a released writer'));
    }

    if (this._ownerWritableStream._state === 'closing') {
      return Promise.reject(new TypeError('cannot close an already-closing stream'));
    }

    return WritableStreamDefaultWriterClose(this);
  }

  releaseLock() {
    if (IsWritableStreamDefaultWriter(this) === false) {
      throw new TypeError('WritableStreamDefaultWriter.prototype.releaseLock can only be used on a WritableStreamDefaultWriter');
    }

    if (this._ownerWritableStream === undefined) {
      return undefined;
    }

    if (this._writeRequests.length > 0) {
      throw new TypeError('Tried to release a writer lock when that writer has pending write() calls un-settled');
    }

    assert(this._ownerWritableStream !== undefined);
    assert(this._ownerWritableStream._writer !== undefined);

    if (this._ownerWritableStream._state === 'writable' || this._ownerReadableStream._state === 'waiting') {
      WritableStreamDefaultWriterRejectClosedPromise(
          this, new TypeError('Writer was released and can no longer be used to monitor the stream\'s closedness'));
    } else {
      WritableStreamDefaultWriterInitializeClosedPromiseAsRejected(
          this, new TypeError('Writer was released and can no longer be used to monitor the stream\'s closedness'));
    }

    WritableStreamDefaultWriterUpdateBackpressure(this, true);

    this._ownerWritableStream._writer = undefined;
    this._ownerWritableStream = undefined;
  }

  write(chunk) {
    if (IsWritableStreamDefaultWriter(this) === false) {
      return Promise.reject(new TypeError('WritableStreamDefaultWriter.prototype.write can only be used on a WritableStreamDefaultWriter'));
    }

    if (this._ownerWritableStream === undefined) {
      return Promise.reject(new TypeError('Cannot write to a stream using a released writer'));
    }

    if (this._ownerWritableStream._state === 'closing') {
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

  if (!Object.prototype.hasOwnProperty.call(x, '_writeRequests')) {
    return false;
  }

  return true;
}

function WritableStreamDefaultWriterClearPendingWriteRequests(writer) {
  for (const writeRequest of writer._writeRequests) {
    writeRequest._reject(new TypeError('Aborted'));
  }
}

function WritableStreamDefaultWriterInitializeClosedPromiseAsRejected(writer, reason) {
  writer._closedPromise = Promise.reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterRejectClosedPromise(writer, reason) {
  writer._closedPromise_reject(reason);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterRejectPendingWriteRequests(writer, reason) {
  while (writer._writeRequests.length > 0) {
    const writeRecord = writer._writeRequests.shift();
    writeRecord._reject(reason);
  }
}

function WritableStreamDefaultWriterResolveClosedPromise(writer) {
  writer._closedPromise_resolve(undefined);
  writer._closedPromise_resolve = undefined;
  writer._closedPromise_reject = undefined;
}

function WritableStreamDefaultWriterUpdateBackpressure(writer, backpressure) {
  if (backpressure) {
    if (writer._readyPromise_resolve === undefined) {
      writer._readyPromise = new Promise((resolve, reject) => {
        writer._readyPromise_resolve = resolve;
      });
    }

    return;
  }

  if (writer._readyPromise_resolve !== undefined) {
    writer._readyPromise_resolve(undefined);
    writer._readyPromise_resolve = undefined;
  }
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

  stream._state = 'closing';

  WritableStreamDefaultWriterUpdateBackpressure(writer, true);

  WritableStreamDefaultControllerClose(stream._writableStreamController);

  return promise;
}

function WritableStreamDefaultWriterGetDesiredSize(writer) {
  const stream = writer._ownerWritableStream;
  const state = stream._state;

  if (state === 'errored' || state === 'closed' || state === 'closing') {
    return null;
  }

  const controller = stream._writableStreamController;
  return WritableStreamDefaultControllerGetDesiredSize(controller);
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
        const state = stream._state;
        if (state === 'closed' || state === 'errored') {
          return;
        }

        WritableStreamDefaultControllerError(controller, r);
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

  return PromiseInvokeOrFallbackOrNoop(controller._underlyingSink, 'abort', [reason], 'close', []);
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
      const state = stream._state;
      if (state === 'writable' || state === 'waiting' || state === 'closing') {
        WritableStreamDefaultControllerError(controller, chunkSizeE);
      }
      return Promise.reject(chunkSizeE);
    }
  }

  const writeRecord = { chunk: chunk };

  try {
    EnqueueValueWithSize(controller._queue, writeRecord, chunkSize);
  } catch (enqueueE) {
    const state = stream._state;
    if (state === 'writable' || state === 'waiting' || state === 'closing') {
      WritableStreamDefaultControllerError(controller, enqueueE);
    }
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
  const shouldAdvanceQueue = WritableStreamDefaultControllerShouldAdvanceQueue(controller);
  if (shouldAdvanceQueue === false) {
    return;
  }

  const writeRecord = PeekQueueValue(controller._queue);

  const stream = controller._controlledWritableStream;

  if (writeRecord === 'close') {
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
        const state = stream._state;
        if (state === 'closed' || state === 'errored') {
          return;
        }

        WritableStreamDefaultControllerError(controller, r);
      }
    )
    .catch(rethrowAssertionErrorRejection);

    return;
  }

  stream._writing = true;

  const sinkWritePromise = PromiseInvokeOrNoop(controller._underlyingSink, 'write', [writeRecord.chunk]);
  sinkWritePromise.then(
    () => {
      const state = stream._state;
      if (state === 'errored' || state === 'closed') {
        return;
      }

      stream._writing = false;

      WritableStreamFulfillWriteRequest(stream);

      DequeueValue(controller._queue);
      WritableStreamDefaultControllerUpdateBackpressure(controller);

      WritableStreamDefaultControllerAdvanceQueueIfNeeded(controller);
    },
    r => {
      const state = stream._state;
      if (state === 'closed' || state === 'errored') {
        return;
      }

      WritableStreamDefaultControllerError(controller, r);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function WritableStreamDefaultControllerUpdateBackpressure(controller) {
  const stream = controller._controlledWritableStream;
  const state = stream._state;

  if (state === 'closing') {
    return;
  }

  assert(state === 'writable' || state === 'waiting');

  const desiredSize = WritableStreamDefaultControllerGetDesiredSize(controller);
  const backpressure = desiredSize <= 0;
  WritableStreamUpdateBackpressure(stream, backpressure);
}

function WritableStreamDefaultControllerShouldAdvanceQueue(controller) {
  const stream = controller._controlledWritableStream;

  if (stream._state === 'closed' || stream._state === 'errored') {
    return false;
  }

  if (controller._started === false) {
    return false;
  }

  if (controller._queue.length === 0) {
    return false;
  }

  if (controller._writing === true) {
    return false;
  }

  return true;
}

// A client of WritableStreamDefaultController may use these functions directly to bypass state check.

function WritableStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledWritableStream;

  const state = stream._state;
  assert(state === 'writable' || state === 'waiting' || state === 'closing');

  controller._queue = [];

  WritableStreamError(stream, e);
}
