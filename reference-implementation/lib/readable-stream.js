'use strict';
const assert = require('better-assert');
const { ArrayBufferCopy, CreateAlgorithmFromUnderlyingMethod, CreateIterResultObject, IsFiniteNonNegativeNumber,
        InvokeOrNoop, IsDetachedBuffer, TransferArrayBuffer, ValidateAndNormalizeHighWaterMark, IsNonNegativeNumber,
        MakeSizeAlgorithmFromSizeFunction, createArrayFromList, typeIsObject } = require('./helpers.js');
const { rethrowAssertionErrorRejection } = require('./utils.js');
const { DequeueValue, EnqueueValueWithSize, ResetQueue } = require('./queue-with-sizes.js');
const { AcquireWritableStreamDefaultWriter, IsWritableStream, IsWritableStreamLocked,
        WritableStreamAbort, WritableStreamDefaultWriterCloseWithErrorPropagation,
        WritableStreamDefaultWriterRelease, WritableStreamDefaultWriterWrite, WritableStreamCloseQueuedOrInFlight } =
      require('./writable-stream.js');

const CancelSteps = Symbol('[[CancelSteps]]');
const PullSteps = Symbol('[[PullSteps]]');

class ReadableStream {
  constructor(underlyingSource = {}, { size, highWaterMark } = {}) {
    InitializeReadableStream(this);
    const type = underlyingSource.type;
    const typeString = String(type);
    if (typeString === 'bytes') {
      if (highWaterMark === undefined) {
        highWaterMark = 0;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);

      if (size !== undefined) {
        throw new RangeError('The strategy for a byte stream cannot have a size function');
      }

      SetUpReadableByteStreamControllerFromUnderlyingSource(this, underlyingSource, highWaterMark);
    } else if (type === undefined) {
      if (highWaterMark === undefined) {
        highWaterMark = 1;
      }
      highWaterMark = ValidateAndNormalizeHighWaterMark(highWaterMark);

      const sizeAlgorithm = MakeSizeAlgorithmFromSizeFunction(size);

      SetUpReadableStreamDefaultControllerFromUnderlyingSource(this, underlyingSource, highWaterMark, sizeAlgorithm);
    } else {
      throw new RangeError('Invalid type is specified');
    }
  }

  get locked() {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('locked');
    }

    return IsReadableStreamLocked(this);
  }

  cancel(reason) {
    if (IsReadableStream(this) === false) {
      return Promise.reject(streamBrandCheckException('cancel'));
    }

    if (IsReadableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot cancel a stream that already has a reader'));
    }

    return ReadableStreamCancel(this, reason);
  }

  getReader({ mode } = {}) {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('getReader');
    }

    if (mode === undefined) {
      return AcquireReadableStreamDefaultReader(this);
    }

    mode = String(mode);

    if (mode === 'byob') {
      return AcquireReadableStreamBYOBReader(this);
    }

    throw new RangeError('Invalid mode is specified');
  }

  pipeThrough({ writable, readable }, options) {
    if (writable === undefined || readable === undefined) {
      throw new TypeError('readable and writable arguments must be defined');
    }

    const promise = this.pipeTo(writable, options);

    ifIsObjectAndHasAPromiseIsHandledInternalSlotSetPromiseIsHandledToTrue(promise);

    return readable;
  }

  pipeTo(dest, { preventClose, preventAbort, preventCancel } = {}) {
    if (IsReadableStream(this) === false) {
      return Promise.reject(streamBrandCheckException('pipeTo'));
    }
    if (IsWritableStream(dest) === false) {
      return Promise.reject(
        new TypeError('ReadableStream.prototype.pipeTo\'s first argument must be a WritableStream'));
    }

    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    if (IsReadableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked ReadableStream'));
    }
    if (IsWritableStreamLocked(dest) === true) {
      return Promise.reject(new TypeError('ReadableStream.prototype.pipeTo cannot be used on a locked WritableStream'));
    }

    const reader = AcquireReadableStreamDefaultReader(this);
    const writer = AcquireWritableStreamDefaultWriter(dest);

    let shuttingDown = false;

    // This is used to keep track of the spec's requirement that we wait for ongoing writes during shutdown.
    let currentWrite = Promise.resolve();

    return new Promise((resolve, reject) => {
      // Using reader and writer, read all chunks from this and write them to dest
      // - Backpressure must be enforced
      // - Shutdown must stop all activity
      function pipeLoop() {
        currentWrite = Promise.resolve();

        if (shuttingDown === true) {
          return Promise.resolve();
        }

        return writer._readyPromise.then(() => {
          return ReadableStreamDefaultReaderRead(reader).then(({ value, done }) => {
            if (done === true) {
              return;
            }

            currentWrite = WritableStreamDefaultWriterWrite(writer, value).catch(() => {});
          });
        })
        .then(pipeLoop);
      }

      // Errors must be propagated forward
      isOrBecomesErrored(this, reader._closedPromise, storedError => {
        if (preventAbort === false) {
          shutdownWithAction(() => WritableStreamAbort(dest, storedError), true, storedError);
        } else {
          shutdown(true, storedError);
        }
      });

      // Errors must be propagated backward
      isOrBecomesErrored(dest, writer._closedPromise, storedError => {
        if (preventCancel === false) {
          shutdownWithAction(() => ReadableStreamCancel(this, storedError), true, storedError);
        } else {
          shutdown(true, storedError);
        }
      });

      // Closing must be propagated forward
      isOrBecomesClosed(this, reader._closedPromise, () => {
        if (preventClose === false) {
          shutdownWithAction(() => WritableStreamDefaultWriterCloseWithErrorPropagation(writer));
        } else {
          shutdown();
        }
      });

      // Closing must be propagated backward
      if (WritableStreamCloseQueuedOrInFlight(dest) === true || dest._state === 'closed') {
        const destClosed = new TypeError('the destination writable stream closed before all data could be piped to it');

        if (preventCancel === false) {
          shutdownWithAction(() => ReadableStreamCancel(this, destClosed), true, destClosed);
        } else {
          shutdown(true, destClosed);
        }
      }

      pipeLoop().catch(err => {
        currentWrite = Promise.resolve();
        rethrowAssertionErrorRejection(err);
      });

      function waitForWritesToFinish() {
        // Another write may have started while we were waiting on this currentWrite, so we have to be sure to wait
        // for that too.
        const oldCurrentWrite = currentWrite;
        return currentWrite.then(() => oldCurrentWrite !== currentWrite ? waitForWritesToFinish() : undefined);
      }

      function isOrBecomesErrored(stream, promise, action) {
        if (stream._state === 'errored') {
          action(stream._storedError);
        } else {
          promise.catch(action).catch(rethrowAssertionErrorRejection);
        }
      }

      function isOrBecomesClosed(stream, promise, action) {
        if (stream._state === 'closed') {
          action();
        } else {
          promise.then(action).catch(rethrowAssertionErrorRejection);
        }
      }

      function shutdownWithAction(action, originalIsError, originalError) {
        if (shuttingDown === true) {
          return;
        }
        shuttingDown = true;

        if (dest._state === 'writable' && WritableStreamCloseQueuedOrInFlight(dest) === false) {
          waitForWritesToFinish().then(doTheRest);
        } else {
          doTheRest();
        }

        function doTheRest() {
          action().then(
            () => finalize(originalIsError, originalError),
            newError => finalize(true, newError)
          )
          .catch(rethrowAssertionErrorRejection);
        }
      }

      function shutdown(isError, error) {
        if (shuttingDown === true) {
          return;
        }
        shuttingDown = true;

        if (dest._state === 'writable' && WritableStreamCloseQueuedOrInFlight(dest) === false) {
          waitForWritesToFinish().then(() => finalize(isError, error)).catch(rethrowAssertionErrorRejection);
        } else {
          finalize(isError, error);
        }
      }

      function finalize(isError, error) {
        WritableStreamDefaultWriterRelease(writer);
        ReadableStreamReaderGenericRelease(reader);

        if (isError) {
          reject(error);
        } else {
          resolve(undefined);
        }
      }
    });
  }

  tee() {
    if (IsReadableStream(this) === false) {
      throw streamBrandCheckException('tee');
    }

    const branches = ReadableStreamTee(this, false);
    return createArrayFromList(branches);
  }
}

module.exports = {
  CreateReadableByteStream,
  CreateReadableStream,
  ReadableStream,
  IsReadableStreamDisturbed,
  ReadableStreamDefaultControllerClose,
  ReadableStreamDefaultControllerEnqueue,
  ReadableStreamDefaultControllerError,
  ReadableStreamDefaultControllerGetDesiredSize,
  ReadableStreamDefaultControllerHasBackpressure,
  ReadableStreamDefaultControllerCanCloseOrEnqueue
};

// Abstract operations for the ReadableStream.

function AcquireReadableStreamBYOBReader(stream) {
  return new ReadableStreamBYOBReader(stream);
}

function AcquireReadableStreamDefaultReader(stream) {
  return new ReadableStreamDefaultReader(stream);
}

// Throws if and only if startAlgorithm throws.
function CreateReadableStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark = 1,
                              sizeAlgorithm = () => 1) {
  assert(IsNonNegativeNumber(highWaterMark) === true);

  const stream = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);

  const controller = Object.create(ReadableStreamDefaultController.prototype);

  SetUpReadableStreamDefaultController(
      stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm
  );

  return stream;
}

// Throws if and only if startAlgorithm throws.
function CreateReadableByteStream(startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark = 0,
                                  autoAllocateChunkSize = undefined) {
  assert(IsNonNegativeNumber(highWaterMark) === true);
  if (autoAllocateChunkSize !== undefined) {
    assert(Number.isInteger(autoAllocateChunkSize) === true);
    assert(autoAllocateChunkSize > 0);
  }

  const stream = Object.create(ReadableStream.prototype);
  InitializeReadableStream(stream);

  const controller = Object.create(ReadableByteStreamController.prototype);

  SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark,
                                    autoAllocateChunkSize);

  return stream;
}

function InitializeReadableStream(stream) {
  stream._state = 'readable';
  stream._reader = undefined;
  stream._storedError = undefined;
  stream._disturbed = false;
}

function IsReadableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readableStreamController')) {
    return false;
  }

  return true;
}

function IsReadableStreamDisturbed(stream) {
  assert(IsReadableStream(stream) === true);

  return stream._disturbed;
}

function IsReadableStreamLocked(stream) {
  assert(IsReadableStream(stream) === true);

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

function ReadableStreamTee(stream, cloneForBranch2) {
  assert(IsReadableStream(stream) === true);
  assert(typeof cloneForBranch2 === 'boolean');

  const reader = AcquireReadableStreamDefaultReader(stream);

  let closedOrErrored = false;
  let canceled1 = false;
  let canceled2 = false;
  let reason1;
  let reason2;
  let branch1;
  let branch2;

  let resolveCancelPromise;
  const cancelPromise = new Promise(resolve => {
    resolveCancelPromise = resolve;
  });

  function pullAlgorithm() {
    return ReadableStreamDefaultReaderRead(reader).then(result => {
      assert(typeIsObject(result));
      const value = result.value;
      const done = result.done;
      assert(typeof done === 'boolean');

      if (done === true && closedOrErrored === false) {
        if (canceled1 === false) {
          ReadableStreamDefaultControllerClose(branch1._readableStreamController);
        }
        if (canceled2 === false) {
          ReadableStreamDefaultControllerClose(branch2._readableStreamController);
        }
        closedOrErrored = true;
      }

      if (closedOrErrored === true) {
        return;
      }

      const value1 = value;
      const value2 = value;

      // There is no way to access the cloning code right now in the reference implementation.
      // If we add one then we'll need an implementation for serializable objects.
      // if (canceled2 === false && cloneForBranch2 === true) {
      //   value2 = StructuredDeserialize(StructuredSerialize(value2));
      // }

      if (canceled1 === false) {
        ReadableStreamDefaultControllerEnqueue(branch1._readableStreamController, value1);
      }

      if (canceled2 === false) {
        ReadableStreamDefaultControllerEnqueue(branch2._readableStreamController, value2);
      }
    });
  }

  function cancel1Algorithm(reason) {
    canceled1 = true;
    reason1 = reason;
    if (canceled2 === true) {
      const compositeReason = createArrayFromList([reason1, reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      resolveCancelPromise(cancelResult);
    }
    return cancelPromise;
  }

  function cancel2Algorithm(reason) {
    canceled2 = true;
    reason2 = reason;
    if (canceled1 === true) {
      const compositeReason = createArrayFromList([reason1, reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      resolveCancelPromise(cancelResult);
    }
    return cancelPromise;
  }

  function startAlgorithm() {}

  branch1 = CreateReadableStream(startAlgorithm, pullAlgorithm, cancel1Algorithm);
  branch2 = CreateReadableStream(startAlgorithm, pullAlgorithm, cancel2Algorithm);

  reader._closedPromise.catch(r => {
    if (closedOrErrored === true) {
      return;
    }

    ReadableStreamDefaultControllerErrorIfNeeded(branch1._readableStreamController, r);
    ReadableStreamDefaultControllerErrorIfNeeded(branch2._readableStreamController, r);
    closedOrErrored = true;
  });

  return [branch1, branch2];
}

// ReadableStream API exposed for controllers.

function ReadableStreamAddReadIntoRequest(stream) {
  assert(IsReadableStreamBYOBReader(stream._reader) === true);
  assert(stream._state === 'readable' || stream._state === 'closed');

  const promise = new Promise((resolve, reject) => {
    const readIntoRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._reader._readIntoRequests.push(readIntoRequest);
  });

  return promise;
}

function ReadableStreamAddReadRequest(stream) {
  assert(IsReadableStreamDefaultReader(stream._reader) === true);
  assert(stream._state === 'readable');

  const promise = new Promise((resolve, reject) => {
    const readRequest = {
      _resolve: resolve,
      _reject: reject
    };

    stream._reader._readRequests.push(readRequest);
  });

  return promise;
}

function ReadableStreamCancel(stream, reason) {
  stream._disturbed = true;

  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  ReadableStreamClose(stream);

  const sourceCancelPromise = stream._readableStreamController[CancelSteps](reason);
  return sourceCancelPromise.then(() => undefined);
}

function ReadableStreamClose(stream) {
  assert(stream._state === 'readable');

  stream._state = 'closed';

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableStreamDefaultReader(reader) === true) {
    for (const { _resolve } of reader._readRequests) {
      _resolve(CreateIterResultObject(undefined, true));
    }
    reader._readRequests = [];
  }

  defaultReaderClosedPromiseResolve(reader);

  return undefined;
}

function ReadableStreamError(stream, e) {
  assert(IsReadableStream(stream) === true);
  assert(stream._state === 'readable');

  stream._state = 'errored';
  stream._storedError = e;

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableStreamDefaultReader(reader) === true) {
    for (const readRequest of reader._readRequests) {
      readRequest._reject(e);
    }

    reader._readRequests = [];
  } else {
    assert(IsReadableStreamBYOBReader(reader));

    for (const readIntoRequest of reader._readIntoRequests) {
      readIntoRequest._reject(e);
    }

    reader._readIntoRequests = [];
  }

  defaultReaderClosedPromiseReject(reader, e);
  reader._closedPromise.catch(() => {});
}

function ReadableStreamFulfillReadIntoRequest(stream, chunk, done) {
  const reader = stream._reader;

  assert(reader._readIntoRequests.length > 0);

  const readIntoRequest = reader._readIntoRequests.shift();
  readIntoRequest._resolve(CreateIterResultObject(chunk, done));
}

function ReadableStreamFulfillReadRequest(stream, chunk, done) {
  const reader = stream._reader;

  assert(reader._readRequests.length > 0);

  const readRequest = reader._readRequests.shift();
  readRequest._resolve(CreateIterResultObject(chunk, done));
}

function ReadableStreamGetNumReadIntoRequests(stream) {
  return stream._reader._readIntoRequests.length;
}

function ReadableStreamGetNumReadRequests(stream) {
  return stream._reader._readRequests.length;
}

function ReadableStreamHasBYOBReader(stream) {
  const reader = stream._reader;

  if (reader === undefined) {
    return false;
  }

  if (IsReadableStreamBYOBReader(reader) === false) {
    return false;
  }

  return true;
}

function ReadableStreamHasDefaultReader(stream) {
  const reader = stream._reader;

  if (reader === undefined) {
    return false;
  }

  if (IsReadableStreamDefaultReader(reader) === false) {
    return false;
  }

  return true;
}

// Readers

class ReadableStreamDefaultReader {
  constructor(stream) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamDefaultReader can only be constructed with a ReadableStream instance');
    }
    if (IsReadableStreamLocked(stream) === true) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    ReadableStreamReaderGenericInitialize(this, stream);

    this._readRequests = [];
  }

  get closed() {
    if (IsReadableStreamDefaultReader(this) === false) {
      return Promise.reject(defaultReaderBrandCheckException('closed'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (IsReadableStreamDefaultReader(this) === false) {
      return Promise.reject(defaultReaderBrandCheckException('cancel'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(readerLockException('cancel'));
    }

    return ReadableStreamReaderGenericCancel(this, reason);
  }

  read() {
    if (IsReadableStreamDefaultReader(this) === false) {
      return Promise.reject(defaultReaderBrandCheckException('read'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(readerLockException('read from'));
    }

    return ReadableStreamDefaultReaderRead(this);
  }

  releaseLock() {
    if (IsReadableStreamDefaultReader(this) === false) {
      throw defaultReaderBrandCheckException('releaseLock');
    }

    if (this._ownerReadableStream === undefined) {
      return;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    ReadableStreamReaderGenericRelease(this);
  }
}

class ReadableStreamBYOBReader {
  constructor(stream) {
    if (!IsReadableStream(stream)) {
      throw new TypeError('ReadableStreamBYOBReader can only be constructed with a ReadableStream instance given a ' +
          'byte source');
    }
    if (IsReadableByteStreamController(stream._readableStreamController) === false) {
      throw new TypeError('Cannot construct a ReadableStreamBYOBReader for a stream not constructed with a byte ' +
          'source');
    }
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    ReadableStreamReaderGenericInitialize(this, stream);

    this._readIntoRequests = [];
  }

  get closed() {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(byobReaderBrandCheckException('closed'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(byobReaderBrandCheckException('cancel'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(readerLockException('cancel'));
    }

    return ReadableStreamReaderGenericCancel(this, reason);
  }

  read(view) {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(byobReaderBrandCheckException('read'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(readerLockException('read from'));
    }

    if (!ArrayBuffer.isView(view)) {
      return Promise.reject(new TypeError('view must be an array buffer view'));
    }

    if (IsDetachedBuffer(view.buffer) === true) {
      return Promise.reject(new TypeError('Cannot read into a view onto a detached ArrayBuffer'));
    }

    if (view.byteLength === 0) {
      return Promise.reject(new TypeError('view must have non-zero byteLength'));
    }

    return ReadableStreamBYOBReaderRead(this, view);
  }

  releaseLock() {
    if (!IsReadableStreamBYOBReader(this)) {
      throw byobReaderBrandCheckException('releaseLock');
    }

    if (this._ownerReadableStream === undefined) {
      return;
    }

    if (this._readIntoRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    ReadableStreamReaderGenericRelease(this);
  }
}

// Abstract operations for the readers.

function IsReadableStreamBYOBReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readIntoRequests')) {
    return false;
  }

  return true;
}

function IsReadableStreamDefaultReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readRequests')) {
    return false;
  }

  return true;
}

function ReadableStreamReaderGenericInitialize(reader, stream) {
  reader._ownerReadableStream = stream;
  stream._reader = reader;

  if (stream._state === 'readable') {
    defaultReaderClosedPromiseInitialize(reader);
  } else if (stream._state === 'closed') {
    defaultReaderClosedPromiseInitializeAsResolved(reader);
  } else {
    assert(stream._state === 'errored');

    defaultReaderClosedPromiseInitializeAsRejected(reader, stream._storedError);
    reader._closedPromise.catch(() => {});
  }
}

// A client of ReadableStreamDefaultReader and ReadableStreamBYOBReader may use these functions directly to bypass state
// check.

function ReadableStreamReaderGenericCancel(reader, reason) {
  const stream = reader._ownerReadableStream;
  assert(stream !== undefined);
  return ReadableStreamCancel(stream, reason);
}

function ReadableStreamReaderGenericRelease(reader) {
  assert(reader._ownerReadableStream !== undefined);
  assert(reader._ownerReadableStream._reader === reader);

  if (reader._ownerReadableStream._state === 'readable') {
    defaultReaderClosedPromiseReject(
        reader,
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
  } else {
    defaultReaderClosedPromiseResetToRejected(
        reader,
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
  }
  reader._closedPromise.catch(() => {});

  reader._ownerReadableStream._reader = undefined;
  reader._ownerReadableStream = undefined;
}

function ReadableStreamBYOBReaderRead(reader, view) {
  const stream = reader._ownerReadableStream;

  assert(stream !== undefined);

  stream._disturbed = true;

  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  // Controllers must implement this.
  return ReadableByteStreamControllerPullInto(stream._readableStreamController, view);
}

function ReadableStreamDefaultReaderRead(reader) {
  const stream = reader._ownerReadableStream;

  assert(stream !== undefined);

  stream._disturbed = true;

  if (stream._state === 'closed') {
    return Promise.resolve(CreateIterResultObject(undefined, true));
  }

  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  assert(stream._state === 'readable');

  return stream._readableStreamController[PullSteps]();
}

// Controllers

class ReadableStreamDefaultController {
  constructor() {
    throw new TypeError();
  }

  get desiredSize() {
    if (IsReadableStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('desiredSize');
    }

    return ReadableStreamDefaultControllerGetDesiredSize(this);
  }

  close() {
    if (IsReadableStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('close');
    }

    if (ReadableStreamDefaultControllerCanCloseOrEnqueue(this) === false) {
      throw new TypeError('The stream is not in a state that permits close');
    }

    ReadableStreamDefaultControllerClose(this);
  }

  enqueue(chunk) {
    if (IsReadableStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('enqueue');
    }

    if (ReadableStreamDefaultControllerCanCloseOrEnqueue(this) === false) {
      throw new TypeError('The stream is not in a state that permits enqueue');
    }

    return ReadableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(e) {
    if (IsReadableStreamDefaultController(this) === false) {
      throw defaultControllerBrandCheckException('error');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    ReadableStreamDefaultControllerError(this, e);
  }

  [CancelSteps](reason) {
    ResetQueue(this);
    return this._cancelAlgorithm(reason);
  }

  [PullSteps]() {
    const stream = this._controlledReadableStream;

    if (this._queue.length > 0) {
      const chunk = DequeueValue(this);

      if (this._closeRequested === true && this._queue.length === 0) {
        ReadableStreamClose(stream);
      } else {
        ReadableStreamDefaultControllerCallPullIfNeeded(this);
      }

      return Promise.resolve(CreateIterResultObject(chunk, false));
    }

    const pendingPromise = ReadableStreamAddReadRequest(stream);
    ReadableStreamDefaultControllerCallPullIfNeeded(this);
    return pendingPromise;
  }
}

// Abstract operations for the ReadableStreamDefaultController.

function IsReadableStreamDefaultController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledReadableStream')) {
    return false;
  }

  return true;
}

function ReadableStreamDefaultControllerCallPullIfNeeded(controller) {
  const shouldPull = ReadableStreamDefaultControllerShouldCallPull(controller);
  if (shouldPull === false) {
    return undefined;
  }

  if (controller._pulling === true) {
    controller._pullAgain = true;
    return undefined;
  }

  assert(controller._pullAgain === false);

  controller._pulling = true;

  const pullPromise = controller._pullAlgorithm();
  pullPromise.then(
    () => {
      controller._pulling = false;

      if (controller._pullAgain === true) {
        controller._pullAgain = false;
        return ReadableStreamDefaultControllerCallPullIfNeeded(controller);
      }
      return undefined;
    },
    e => {
      ReadableStreamDefaultControllerErrorIfNeeded(controller, e);
    }
  )
  .catch(rethrowAssertionErrorRejection);

  return undefined;
}

function ReadableStreamDefaultControllerShouldCallPull(controller) {
  const stream = controller._controlledReadableStream;

  if (ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) === false) {
    return false;
  }

  if (controller._started === false) {
    return false;
  }

  if (IsReadableStreamLocked(stream) === true && ReadableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }

  const desiredSize = ReadableStreamDefaultControllerGetDesiredSize(controller);
  if (desiredSize > 0) {
    return true;
  }

  return false;
}

// A client of ReadableStreamDefaultController may use these functions directly to bypass state check.

function ReadableStreamDefaultControllerClose(controller) {
  const stream = controller._controlledReadableStream;

  assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) === true);

  controller._closeRequested = true;

  if (controller._queue.length === 0) {
    ReadableStreamClose(stream);
  }
}

function ReadableStreamDefaultControllerEnqueue(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) === true);

  if (IsReadableStreamLocked(stream) === true && ReadableStreamGetNumReadRequests(stream) > 0) {
    ReadableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    let chunkSize;
    try {
      chunkSize = controller._strategySizeAlgorithm(chunk);
    } catch (chunkSizeE) {
      ReadableStreamDefaultControllerErrorIfNeeded(controller, chunkSizeE);
      throw chunkSizeE;
    }

    try {
      EnqueueValueWithSize(controller, chunk, chunkSize);
    } catch (enqueueE) {
      ReadableStreamDefaultControllerErrorIfNeeded(controller, enqueueE);
      throw enqueueE;
    }
  }

  ReadableStreamDefaultControllerCallPullIfNeeded(controller);

  return undefined;
}

function ReadableStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledReadableStream;

  assert(stream._state === 'readable');

  ResetQueue(controller);

  ReadableStreamError(stream, e);
}

function ReadableStreamDefaultControllerErrorIfNeeded(controller, e) {
  if (controller._controlledReadableStream._state === 'readable') {
    ReadableStreamDefaultControllerError(controller, e);
  }
}

function ReadableStreamDefaultControllerGetDesiredSize(controller) {
  const stream = controller._controlledReadableStream;
  const state = stream._state;

  if (state === 'errored') {
    return null;
  }
  if (state === 'closed') {
    return 0;
  }

  return controller._strategyHWM - controller._queueTotalSize;
}

// This is used in the implementation of TransformStream.
function ReadableStreamDefaultControllerHasBackpressure(controller) {
  if (ReadableStreamDefaultControllerShouldCallPull(controller) === true) {
    return false;
  }

  return true;
}

function ReadableStreamDefaultControllerCanCloseOrEnqueue(controller) {
  const state = controller._controlledReadableStream._state;

  if (controller._closeRequested === false && state === 'readable') {
    return true;
  }

  return false;
}

function SetUpReadableStreamDefaultController(
  stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark, sizeAlgorithm) {
  assert(stream._readableStreamController === undefined);

  controller._controlledReadableStream = stream;

  controller._queue = undefined;
  controller._queueTotalSize = undefined;
  ResetQueue(controller);

  controller._started = false;
  controller._closeRequested = false;
  controller._pullAgain = false;
  controller._pulling = false;

  controller._strategySizeAlgorithm = sizeAlgorithm;
  controller._strategyHWM = highWaterMark;

  controller._pullAlgorithm = pullAlgorithm;
  controller._cancelAlgorithm = cancelAlgorithm;

  stream._readableStreamController = controller;

  const startResult = startAlgorithm();
  Promise.resolve(startResult).then(
    () => {
      controller._started = true;

      assert(controller._pulling === false);
      assert(controller._pullAgain === false);

      ReadableStreamDefaultControllerCallPullIfNeeded(controller);
    },
    r => {
      ReadableStreamDefaultControllerErrorIfNeeded(controller, r);
    }
  )
  .catch(rethrowAssertionErrorRejection);
}

function SetUpReadableStreamDefaultControllerFromUnderlyingSource(stream, underlyingSource, highWaterMark,
                                                                  sizeAlgorithm) {
  assert(underlyingSource !== undefined);

  const controller = Object.create(ReadableStreamDefaultController.prototype);

  function startAlgorithm() {
    return InvokeOrNoop(underlyingSource, 'start', [controller]);
  }

  const pullAlgorithm = CreateAlgorithmFromUnderlyingMethod(underlyingSource, 'pull', 0, [controller]);
  const cancelAlgorithm = CreateAlgorithmFromUnderlyingMethod(underlyingSource, 'cancel', 1, []);

  SetUpReadableStreamDefaultController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm,
                                       highWaterMark, sizeAlgorithm);
}

class ReadableStreamBYOBRequest {
  constructor(controller, view) {
    if (IsReadableByteStreamController(controller) === false) {
      throw new TypeError('Cannot construct a ReadableStreamBYOBRequest without a ReadableByteStreamController');
    }

    this._associatedReadableByteStreamController = controller;
    this._view = view;
  }

  get view() {
    if (IsReadableStreamBYOBRequest(this) === false) {
      throw byobRequestBrandCheckException('view');
    }

    return this._view;
  }

  respond(bytesWritten) {
    if (IsReadableStreamBYOBRequest(this) === false) {
      throw byobRequestBrandCheckException('respond');
    }

    if (this._associatedReadableByteStreamController === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    if (IsDetachedBuffer(this._view.buffer) === true) {
      throw new TypeError('The BYOB request\'s buffer has been detached and so cannot be used as a response');
    }

    ReadableByteStreamControllerRespond(this._associatedReadableByteStreamController, bytesWritten);
  }

  respondWithNewView(view) {
    if (IsReadableStreamBYOBRequest(this) === false) {
      throw byobRequestBrandCheckException('respond');
    }

    if (this._associatedReadableByteStreamController === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    if (!ArrayBuffer.isView(view)) {
      throw new TypeError('You can only respond with array buffer views');
    }

    if (IsDetachedBuffer(view.buffer) === true) {
      throw new TypeError('The supplied view\'s buffer has been detached and so cannot be used as a response');
    }

    ReadableByteStreamControllerRespondWithNewView(this._associatedReadableByteStreamController, view);
  }
}

class ReadableByteStreamController {
  constructor() {
    throw new TypeError('ReadableByteStreamController constructor cannot be used directly');
  }

  get byobRequest() {
    if (IsReadableByteStreamController(this) === false) {
      throw byteStreamControllerBrandCheckException('byobRequest');
    }

    if (this._byobRequest === undefined && this._pendingPullIntos.length > 0) {
      const firstDescriptor = this._pendingPullIntos[0];
      const view = new Uint8Array(firstDescriptor.buffer,
                                  firstDescriptor.byteOffset + firstDescriptor.bytesFilled,
                                  firstDescriptor.byteLength - firstDescriptor.bytesFilled);

      this._byobRequest = new ReadableStreamBYOBRequest(this, view);
    }

    return this._byobRequest;
  }

  get desiredSize() {
    if (IsReadableByteStreamController(this) === false) {
      throw byteStreamControllerBrandCheckException('desiredSize');
    }

    return ReadableByteStreamControllerGetDesiredSize(this);
  }

  close() {
    if (IsReadableByteStreamController(this) === false) {
      throw byteStreamControllerBrandCheckException('close');
    }

    if (this._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    const state = this._controlledReadableByteStream._state;
    if (state !== 'readable') {
      throw new TypeError(`The stream (in ${state} state) is not in the readable state and cannot be closed`);
    }

    ReadableByteStreamControllerClose(this);
  }

  enqueue(chunk) {
    if (IsReadableByteStreamController(this) === false) {
      throw byteStreamControllerBrandCheckException('enqueue');
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    const state = this._controlledReadableByteStream._state;
    if (state !== 'readable') {
      throw new TypeError(`The stream (in ${state} state) is not in the readable state and cannot be enqueued to`);
    }

    if (!ArrayBuffer.isView(chunk)) {
      throw new TypeError('You can only enqueue array buffer views when using a ReadableByteStreamController');
    }

    if (IsDetachedBuffer(chunk.buffer) === true) {
      throw new TypeError('Cannot enqueue a view onto a detached ArrayBuffer');
    }

    ReadableByteStreamControllerEnqueue(this, chunk);
  }

  error(e) {
    if (IsReadableByteStreamController(this) === false) {
      throw byteStreamControllerBrandCheckException('error');
    }

    const stream = this._controlledReadableByteStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    ReadableByteStreamControllerError(this, e);
  }

  [CancelSteps](reason) {
    if (this._pendingPullIntos.length > 0) {
      const firstDescriptor = this._pendingPullIntos[0];
      firstDescriptor.bytesFilled = 0;
    }

    ResetQueue(this);

    return this._cancelAlgorithm(reason);
  }

  [PullSteps]() {
    const stream = this._controlledReadableByteStream;
    assert(ReadableStreamHasDefaultReader(stream) === true);

    if (this._queueTotalSize > 0) {
      assert(ReadableStreamGetNumReadRequests(stream) === 0);

      const entry = this._queue.shift();
      this._queueTotalSize -= entry.byteLength;

      ReadableByteStreamControllerHandleQueueDrain(this);

      let view;
      try {
        view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
      } catch (viewE) {
        return Promise.reject(viewE);
      }

      return Promise.resolve(CreateIterResultObject(view, false));
    }

    const autoAllocateChunkSize = this._autoAllocateChunkSize;
    if (autoAllocateChunkSize !== undefined) {
      let buffer;
      try {
        buffer = new ArrayBuffer(autoAllocateChunkSize);
      } catch (bufferE) {
        return Promise.reject(bufferE);
      }

      const pullIntoDescriptor = {
        buffer,
        byteOffset: 0,
        byteLength: autoAllocateChunkSize,
        bytesFilled: 0,
        elementSize: 1,
        ctor: Uint8Array,
        readerType: 'default'
      };

      this._pendingPullIntos.push(pullIntoDescriptor);
    }

    const promise = ReadableStreamAddReadRequest(stream);

    ReadableByteStreamControllerCallPullIfNeeded(this);

    return promise;
  }
}

// Abstract operations for the ReadableByteStreamController.

function IsReadableByteStreamController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledReadableByteStream')) {
    return false;
  }

  return true;
}

function IsReadableStreamBYOBRequest(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_associatedReadableByteStreamController')) {
    return false;
  }

  return true;
}

function ReadableByteStreamControllerCallPullIfNeeded(controller) {
  const shouldPull = ReadableByteStreamControllerShouldCallPull(controller);
  if (shouldPull === false) {
    return undefined;
  }

  if (controller._pulling === true) {
    controller._pullAgain = true;
    return undefined;
  }

  assert(controller._pullAgain === false);

  controller._pulling = true;

  // TODO: Test controller argument
  const pullPromise = controller._pullAlgorithm();
  pullPromise.then(
    () => {
      controller._pulling = false;

      if (controller._pullAgain === true) {
        controller._pullAgain = false;
        ReadableByteStreamControllerCallPullIfNeeded(controller);
      }
    },
    e => {
      if (controller._controlledReadableByteStream._state === 'readable') {
        ReadableByteStreamControllerError(controller, e);
      }
    }
  )
  .catch(rethrowAssertionErrorRejection);

  return undefined;
}

function ReadableByteStreamControllerClearPendingPullIntos(controller) {
  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  controller._pendingPullIntos = [];
}

function ReadableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor) {
  assert(stream._state !== 'errored');

  let done = false;
  if (stream._state === 'closed') {
    assert(pullIntoDescriptor.bytesFilled === 0);
    done = true;
  }

  const filledView = ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === 'default') {
    ReadableStreamFulfillReadRequest(stream, filledView, done);
  } else {
    assert(pullIntoDescriptor.readerType === 'byob');
    ReadableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

function ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor) {
  const bytesFilled = pullIntoDescriptor.bytesFilled;
  const elementSize = pullIntoDescriptor.elementSize;

  assert(bytesFilled <= pullIntoDescriptor.byteLength);
  assert(bytesFilled % elementSize === 0);

  return new pullIntoDescriptor.ctor(
      pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, bytesFilled / elementSize);
}

function ReadableByteStreamControllerEnqueueChunkToQueue(controller, buffer, byteOffset, byteLength) {
  controller._queue.push({ buffer, byteOffset, byteLength });
  controller._queueTotalSize += byteLength;
}

function ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) {
  const elementSize = pullIntoDescriptor.elementSize;

  const currentAlignedBytes = pullIntoDescriptor.bytesFilled - pullIntoDescriptor.bytesFilled % elementSize;

  const maxBytesToCopy = Math.min(controller._queueTotalSize,
                                  pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled);
  const maxBytesFilled = pullIntoDescriptor.bytesFilled + maxBytesToCopy;
  const maxAlignedBytes = maxBytesFilled - maxBytesFilled % elementSize;

  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  if (maxAlignedBytes > currentAlignedBytes) {
    totalBytesToCopyRemaining = maxAlignedBytes - pullIntoDescriptor.bytesFilled;
    ready = true;
  }

  const queue = controller._queue;

  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];

    const bytesToCopy = Math.min(totalBytesToCopyRemaining, headOfQueue.byteLength);

    const destStart = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    ArrayBufferCopy(pullIntoDescriptor.buffer, destStart, headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy);

    if (headOfQueue.byteLength === bytesToCopy) {
      queue.shift();
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller._queueTotalSize -= bytesToCopy;

    ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesToCopy, pullIntoDescriptor);

    totalBytesToCopyRemaining -= bytesToCopy;
  }

  if (ready === false) {
    assert(controller._queueTotalSize === 0);
    assert(pullIntoDescriptor.bytesFilled > 0);
    assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }

  return ready;
}

function ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, size, pullIntoDescriptor) {
  assert(controller._pendingPullIntos.length === 0 || controller._pendingPullIntos[0] === pullIntoDescriptor);

  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  pullIntoDescriptor.bytesFilled += size;
}

function ReadableByteStreamControllerHandleQueueDrain(controller) {
  assert(controller._controlledReadableByteStream._state === 'readable');

  if (controller._queueTotalSize === 0 && controller._closeRequested === true) {
    ReadableStreamClose(controller._controlledReadableByteStream);
  } else {
    ReadableByteStreamControllerCallPullIfNeeded(controller);
  }
}

function ReadableByteStreamControllerInvalidateBYOBRequest(controller) {
  if (controller._byobRequest === undefined) {
    return;
  }

  controller._byobRequest._associatedReadableByteStreamController = undefined;
  controller._byobRequest._view = undefined;
  controller._byobRequest = undefined;
}

function ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller) {
  assert(controller._closeRequested === false);

  while (controller._pendingPullIntos.length > 0) {
    if (controller._queueTotalSize === 0) {
      return;
    }

    const pullIntoDescriptor = controller._pendingPullIntos[0];

    if (ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) === true) {
      ReadableByteStreamControllerShiftPendingPullInto(controller);

      ReadableByteStreamControllerCommitPullIntoDescriptor(
        controller._controlledReadableByteStream,
        pullIntoDescriptor
      );
    }
  }
}

function ReadableByteStreamControllerPullInto(controller, view) {
  const stream = controller._controlledReadableByteStream;

  let elementSize = 1;
  if (view.constructor !== DataView) {
    elementSize = view.constructor.BYTES_PER_ELEMENT;
  }

  const ctor = view.constructor;

  const buffer = TransferArrayBuffer(view.buffer);
  const pullIntoDescriptor = {
    buffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    bytesFilled: 0,
    elementSize,
    ctor,
    readerType: 'byob'
  };

  if (controller._pendingPullIntos.length > 0) {
    controller._pendingPullIntos.push(pullIntoDescriptor);

    // No ReadableByteStreamControllerCallPullIfNeeded() call since:
    // - No change happens on desiredSize
    // - The source has already been notified of that there's at least 1 pending read(view)

    return ReadableStreamAddReadIntoRequest(stream);
  }

  if (stream._state === 'closed') {
    const emptyView = new view.constructor(pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, 0);
    return Promise.resolve(CreateIterResultObject(emptyView, true));
  }

  if (controller._queueTotalSize > 0) {
    if (ReadableByteStreamControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) === true) {
      const filledView = ReadableByteStreamControllerConvertPullIntoDescriptor(pullIntoDescriptor);

      ReadableByteStreamControllerHandleQueueDrain(controller);

      return Promise.resolve(CreateIterResultObject(filledView, false));
    }

    if (controller._closeRequested === true) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ReadableByteStreamControllerError(controller, e);

      return Promise.reject(e);
    }
  }

  controller._pendingPullIntos.push(pullIntoDescriptor);

  const promise = ReadableStreamAddReadIntoRequest(stream);

  ReadableByteStreamControllerCallPullIfNeeded(controller);

  return promise;
}

function ReadableByteStreamControllerRespondInClosedState(controller, firstDescriptor) {
  firstDescriptor.buffer = TransferArrayBuffer(firstDescriptor.buffer);

  assert(firstDescriptor.bytesFilled === 0);

  const stream = controller._controlledReadableByteStream;
  if (ReadableStreamHasBYOBReader(stream) === true) {
    while (ReadableStreamGetNumReadIntoRequests(stream) > 0) {
      const pullIntoDescriptor = ReadableByteStreamControllerShiftPendingPullInto(controller);
      ReadableByteStreamControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor);
    }
  }
}

function ReadableByteStreamControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor) {
  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
    throw new RangeError('bytesWritten out of range');
  }

  ReadableByteStreamControllerFillHeadPullIntoDescriptor(controller, bytesWritten, pullIntoDescriptor);

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    // TODO: Figure out whether we should detach the buffer or not here.
    return;
  }

  ReadableByteStreamControllerShiftPendingPullInto(controller);

  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, end);
    ReadableByteStreamControllerEnqueueChunkToQueue(controller, remainder, 0, remainder.byteLength);
  }

  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  pullIntoDescriptor.bytesFilled -= remainderSize;
  ReadableByteStreamControllerCommitPullIntoDescriptor(controller._controlledReadableByteStream, pullIntoDescriptor);

  ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
}

function ReadableByteStreamControllerRespondInternal(controller, bytesWritten) {
  const firstDescriptor = controller._pendingPullIntos[0];

  const stream = controller._controlledReadableByteStream;

  if (stream._state === 'closed') {
    if (bytesWritten !== 0) {
      throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
    }

    ReadableByteStreamControllerRespondInClosedState(controller, firstDescriptor);
  } else {
    assert(stream._state === 'readable');

    ReadableByteStreamControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
  }
}

function ReadableByteStreamControllerShiftPendingPullInto(controller) {
  const descriptor = controller._pendingPullIntos.shift();
  ReadableByteStreamControllerInvalidateBYOBRequest(controller);
  return descriptor;
}

function ReadableByteStreamControllerShouldCallPull(controller) {
  const stream = controller._controlledReadableByteStream;

  if (stream._state !== 'readable') {
    return false;
  }

  if (controller._closeRequested === true) {
    return false;
  }

  if (controller._started === false) {
    return false;
  }

  if (ReadableStreamHasDefaultReader(stream) === true && ReadableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }

  if (ReadableStreamHasBYOBReader(stream) === true && ReadableStreamGetNumReadIntoRequests(stream) > 0) {
    return true;
  }

  if (ReadableByteStreamControllerGetDesiredSize(controller) > 0) {
    return true;
  }

  return false;
}

// A client of ReadableByteStreamController may use these functions directly to bypass state check.

function ReadableByteStreamControllerClose(controller) {
  const stream = controller._controlledReadableByteStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  if (controller._queueTotalSize > 0) {
    controller._closeRequested = true;

    return;
  }

  if (controller._pendingPullIntos.length > 0) {
    const firstPendingPullInto = controller._pendingPullIntos[0];
    if (firstPendingPullInto.bytesFilled > 0) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ReadableByteStreamControllerError(controller, e);

      throw e;
    }
  }

  ReadableStreamClose(stream);
}

function ReadableByteStreamControllerEnqueue(controller, chunk) {
  const stream = controller._controlledReadableByteStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  const buffer = chunk.buffer;
  const byteOffset = chunk.byteOffset;
  const byteLength = chunk.byteLength;
  const transferredBuffer = TransferArrayBuffer(buffer);

  if (ReadableStreamHasDefaultReader(stream) === true) {
    if (ReadableStreamGetNumReadRequests(stream) === 0) {
      ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    } else {
      assert(controller._queue.length === 0);

      const transferredView = new Uint8Array(transferredBuffer, byteOffset, byteLength);
      ReadableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else if (ReadableStreamHasBYOBReader(stream) === true) {
    // TODO: Ideally in this branch detaching should happen only if the buffer is not consumed fully.
    ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    ReadableByteStreamControllerProcessPullIntoDescriptorsUsingQueue(controller);
  } else {
    assert(IsReadableStreamLocked(stream) === false);
    ReadableByteStreamControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
  }
}

function ReadableByteStreamControllerError(controller, e) {
  const stream = controller._controlledReadableByteStream;

  assert(stream._state === 'readable');

  ReadableByteStreamControllerClearPendingPullIntos(controller);

  ResetQueue(controller);
  ReadableStreamError(stream, e);
}

function ReadableByteStreamControllerGetDesiredSize(controller) {
  const stream = controller._controlledReadableByteStream;
  const state = stream._state;

  if (state === 'errored') {
    return null;
  }
  if (state === 'closed') {
    return 0;
  }

  return controller._strategyHWM - controller._queueTotalSize;
}

function ReadableByteStreamControllerRespond(controller, bytesWritten) {
  bytesWritten = Number(bytesWritten);
  if (IsFiniteNonNegativeNumber(bytesWritten) === false) {
    throw new RangeError('bytesWritten must be a finite');
  }

  assert(controller._pendingPullIntos.length > 0);

  ReadableByteStreamControllerRespondInternal(controller, bytesWritten);
}

function ReadableByteStreamControllerRespondWithNewView(controller, view) {
  assert(controller._pendingPullIntos.length > 0);

  const firstDescriptor = controller._pendingPullIntos[0];

  if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== view.byteOffset) {
    throw new RangeError('The region specified by view does not match byobRequest');
  }
  if (firstDescriptor.byteLength !== view.byteLength) {
    throw new RangeError('The buffer of view has different capacity than byobRequest');
  }

  firstDescriptor.buffer = view.buffer;

  ReadableByteStreamControllerRespondInternal(controller, view.byteLength);
}

function SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm,
                                           highWaterMark, autoAllocateChunkSize) {
  assert(stream._readableStreamController === undefined);
  if (autoAllocateChunkSize !== undefined) {
    assert(Number.isInteger(autoAllocateChunkSize) === true);
    assert(autoAllocateChunkSize > 0);
  }

  controller._controlledReadableByteStream = stream;

  controller._pullAgain = false;
  controller._pulling = false;

  ReadableByteStreamControllerClearPendingPullIntos(controller);

  // Need to set the slots so that the assert doesn't fire. In the spec the slots already exist implicitly.
  controller._queue = controller._queueTotalSize = undefined;
  ResetQueue(controller);

  controller._closeRequested = false;
  controller._started = false;

  controller._strategyHWM = ValidateAndNormalizeHighWaterMark(highWaterMark);

  controller._pullAlgorithm = pullAlgorithm;
  controller._cancelAlgorithm = cancelAlgorithm;

  controller._autoAllocateChunkSize = autoAllocateChunkSize;

  controller._pendingPullIntos = [];

  stream._readableStreamController = controller;

  const startResult = startAlgorithm();
  Promise.resolve(startResult).then(
      () => {
        controller._started = true;

        assert(controller._pulling === false);
        assert(controller._pullAgain === false);

        ReadableByteStreamControllerCallPullIfNeeded(controller);
      },
      r => {
        if (stream._state === 'readable') {
          ReadableByteStreamControllerError(controller, r);
        }
      }
  )
      .catch(rethrowAssertionErrorRejection);
}

function SetUpReadableByteStreamControllerFromUnderlyingSource(stream, underlyingByteSource, highWaterMark) {
  assert(underlyingByteSource !== undefined);

  const controller = Object.create(ReadableByteStreamController.prototype);

  function startAlgorithm() {
    return InvokeOrNoop(underlyingByteSource, 'start', [controller]);
  }

  const pullAlgorithm = CreateAlgorithmFromUnderlyingMethod(underlyingByteSource, 'pull', 0, [controller]);
  const cancelAlgorithm = CreateAlgorithmFromUnderlyingMethod(underlyingByteSource, 'cancel', 1, []);

  const autoAllocateChunkSize = underlyingByteSource.autoAllocateChunkSize;
  if (autoAllocateChunkSize !== undefined) {
    if (Number.isInteger(autoAllocateChunkSize) === false || autoAllocateChunkSize <= 0) {
      throw new RangeError('autoAllocateChunkSize must be a positive integer');
    }
  }

  SetUpReadableByteStreamController(stream, controller, startAlgorithm, pullAlgorithm, cancelAlgorithm, highWaterMark,
                                    autoAllocateChunkSize);
}

// Helper functions for the ReadableStream.

function streamBrandCheckException(name) {
  return new TypeError(`ReadableStream.prototype.${name} can only be used on a ReadableStream`);
}

// Helper functions for the readers.

function readerLockException(name) {
  return new TypeError('Cannot ' + name + ' a stream using a released reader');
}

// Helper functions for the ReadableStreamDefaultReader.

function defaultReaderBrandCheckException(name) {
  return new TypeError(
    `ReadableStreamDefaultReader.prototype.${name} can only be used on a ReadableStreamDefaultReader`);
}

function defaultReaderClosedPromiseInitialize(reader) {
  reader._closedPromise = new Promise((resolve, reject) => {
    reader._closedPromise_resolve = resolve;
    reader._closedPromise_reject = reject;
  });
}

function defaultReaderClosedPromiseInitializeAsRejected(reader, reason) {
  reader._closedPromise = Promise.reject(reason);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

function defaultReaderClosedPromiseInitializeAsResolved(reader) {
  reader._closedPromise = Promise.resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

function defaultReaderClosedPromiseReject(reader, reason) {
  assert(reader._closedPromise_resolve !== undefined);
  assert(reader._closedPromise_reject !== undefined);

  reader._closedPromise_reject(reason);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

function defaultReaderClosedPromiseResetToRejected(reader, reason) {
  assert(reader._closedPromise_resolve === undefined);
  assert(reader._closedPromise_reject === undefined);

  reader._closedPromise = Promise.reject(reason);
}

function defaultReaderClosedPromiseResolve(reader) {
  assert(reader._closedPromise_resolve !== undefined);
  assert(reader._closedPromise_reject !== undefined);

  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

// Helper functions for the ReadableStreamDefaultReader.

function byobReaderBrandCheckException(name) {
  return new TypeError(
    `ReadableStreamBYOBReader.prototype.${name} can only be used on a ReadableStreamBYOBReader`);
}

// Helper functions for the ReadableStreamDefaultController.

function defaultControllerBrandCheckException(name) {
  return new TypeError(
    `ReadableStreamDefaultController.prototype.${name} can only be used on a ReadableStreamDefaultController`);
}

// Helper functions for the ReadableStreamBYOBRequest.

function byobRequestBrandCheckException(name) {
  return new TypeError(
    `ReadableStreamBYOBRequest.prototype.${name} can only be used on a ReadableStreamBYOBRequest`);
}

// Helper functions for the ReadableByteStreamController.

function byteStreamControllerBrandCheckException(name) {
  return new TypeError(
    `ReadableByteStreamController.prototype.${name} can only be used on a ReadableByteStreamController`);
}

// Helper function for ReadableStream pipeThrough

function ifIsObjectAndHasAPromiseIsHandledInternalSlotSetPromiseIsHandledToTrue(promise) {
  try {
    // This relies on the brand-check that is enforced by Promise.prototype.then(). As with the rest of the reference
    // implementation, it doesn't attempt to do the right thing if someone has modified the global environment.
    Promise.prototype.then.call(promise, undefined, () => {});
  } catch (e) {
    // The brand check failed, therefore the internal slot is not present and there's nothing further to do.
  }
}
