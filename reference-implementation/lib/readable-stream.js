const assert = require('assert');
import { ArrayBufferCopy, CreateIterResultObject, IsFiniteNonNegativeNumber, InvokeOrNoop, PromiseInvokeOrNoop,
         TransferArrayBuffer, ValidateAndNormalizeQueuingStrategy,
         ValidateAndNormalizeHighWaterMark } from './helpers';
import { createArrayFromList, createDataProperty, typeIsObject } from './helpers';
import { rethrowAssertionErrorRejection } from './utils';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';

const InternalCancel = Symbol();
const InternalPull = Symbol();

export default class ReadableStream {
  constructor(underlyingSource = {}, { size, highWaterMark } = {}) {
    // Exposed to controllers.
    this._state = 'readable';

    this._reader = undefined;
    this._storedError = undefined;

    this._disturbed = false;

    // Initialize to undefined first because the constructor of the controller checks this
    // variable to validate the caller.
    this._readableStreamController = undefined;
    const byob = underlyingSource['byob'];
    if (byob === true) {
      if (highWaterMark === undefined) {
        highWaterMark = 0;
      }
      this._readableStreamController = new ReadableStreamBYOBController(this, underlyingSource, highWaterMark);
    } else {
      if (highWaterMark === undefined) {
        highWaterMark = 1;
      }
      this._readableStreamController = new ReadableStreamDefaultController(this, underlyingSource, size, highWaterMark);
    }
  }

  get locked() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableStream.prototype.locked can only be used on a ReadableStream');
    }

    return IsReadableStreamLocked(this);
  }

  cancel(reason) {
    if (IsReadableStream(this) === false) {
      return Promise.reject(new TypeError('ReadableStream.prototype.cancel can only be used on a ReadableStream'));
    }

    if (IsReadableStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot cancel a stream that already has a reader'));
    }

    return ReadableStreamCancel(this, reason);
  }

  getBYOBReader() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableStream.prototype.getBYOBReader can only be used on a ReadableStream constructed ' +
          'with a byte source');
    }

    if (IsReadableStreamBYOBController(this._readableStreamController) === false) {
      throw new TypeError('Cannot get a ReadableStreamBYOBReader for a stream not constructed with a byte source');
    }

    return AcquireReadableStreamBYOBReader(this);
  }

  getReader() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableStream.prototype.getReader can only be used on a ReadableStream');
    }

    return AcquireReadableStreamDefaultReader(this);
  }

  pipeThrough({ writable, readable }, options) {
    this.pipeTo(writable, options);
    return readable;
  }

  pipeTo(dest, { preventClose, preventAbort, preventCancel } = {}) {
    preventClose = Boolean(preventClose);
    preventAbort = Boolean(preventAbort);
    preventCancel = Boolean(preventCancel);

    const source = this;

    let reader;
    let lastRead;
    let lastWrite;
    let closedPurposefully = false;
    let resolvePipeToPromise;
    let rejectPipeToPromise;

    return new Promise((resolve, reject) => {
      resolvePipeToPromise = resolve;
      rejectPipeToPromise = reject;

      reader = source.getReader();

      reader.closed.catch(abortDest);
      dest.closed.then(
        () => {
          if (!closedPurposefully) {
            cancelSource(new TypeError('destination is closing or closed and cannot be piped to anymore'));
          }
        },
        cancelSource
      );

      doPipe();
    });

    function doPipe() {
      lastRead = reader.read();
      Promise.all([lastRead, dest.ready]).then(([{ value, done }]) => {
        if (Boolean(done) === true) {
          closeDest();
        } else if (dest.state === 'writable') {
          lastWrite = dest.write(value);
          doPipe();
        }
      })
      .catch(rethrowAssertionErrorRejection);

      // Any failures will be handled by listening to reader.closed and dest.closed above.
      // TODO: handle malicious dest.write/dest.close?
    }

    function cancelSource(reason) {
      if (preventCancel === false) {
        reader.cancel(reason);
        reader.releaseLock();
        rejectPipeToPromise(reason);
      } else {
        // If we don't cancel, we need to wait for lastRead to finish before we're allowed to release.
        // We don't need to handle lastRead failing because that will trigger abortDest which takes care of
        // both of these.
        lastRead.then(() => {
          reader.releaseLock();
          rejectPipeToPromise(reason);
        });
      }
    }

    function closeDest() {
      // Does not need to wait for lastRead since it occurs only on source closed.

      reader.releaseLock();

      const destState = dest.state;
      if (preventClose === false && (destState === 'waiting' || destState === 'writable')) {
        closedPurposefully = true;
        dest.close().then(resolvePipeToPromise, rejectPipeToPromise);
      } else if (lastWrite !== undefined) {
        lastWrite.then(resolvePipeToPromise, rejectPipeToPromise);
      } else {
        resolvePipeToPromise();
      }
    }

    function abortDest(reason) {
      // Does not need to wait for lastRead since it only occurs on source errored.

      reader.releaseLock();

      if (preventAbort === false) {
        dest.abort(reason);
      }
      rejectPipeToPromise(reason);
    }
  }

  tee() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableStream.prototype.tee can only be used on a ReadableStream');
    }

    const branches = ReadableStreamTee(this, false);
    return createArrayFromList(branches);
  }
}

// Abstract operations for the ReadableStream.

function AcquireReadableStreamBYOBReader(stream) {
  return new ReadableStreamBYOBReader(stream);
}

function AcquireReadableStreamDefaultReader(stream) {
  return new ReadableStreamDefaultReader(stream);
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

export function IsReadableStreamDisturbed(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamDisturbed should only be used on known readable streams');

  return stream._disturbed;
}

function IsReadableStreamLocked(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamLocked should only be used on known readable streams');

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

function ReadableStreamTee(stream, shouldClone) {
  assert(IsReadableStream(stream) === true);
  assert(typeof shouldClone === 'boolean');

  const reader = AcquireReadableStreamDefaultReader(stream);

  const teeState = {
    closedOrErrored: false,
    canceled1: false,
    canceled2: false,
    reason1: undefined,
    reason2: undefined
  };
  teeState.promise = new Promise(resolve => teeState._resolve = resolve);

  const pull = create_ReadableStreamTeePullFunction();
  pull._reader = reader;
  pull._teeState = teeState;
  pull._shouldClone = shouldClone;

  const cancel1 = create_ReadableStreamTeeBranch1CancelFunction();
  cancel1._stream = stream;
  cancel1._teeState = teeState;

  const cancel2 = create_ReadableStreamTeeBranch2CancelFunction();
  cancel2._stream = stream;
  cancel2._teeState = teeState;

  const underlyingSource1 = Object.create(Object.prototype);
  createDataProperty(underlyingSource1, 'pull', pull);
  createDataProperty(underlyingSource1, 'cancel', cancel1);
  const branch1Stream = new ReadableStream(underlyingSource1);

  const underlyingSource2 = Object.create(Object.prototype);
  createDataProperty(underlyingSource2, 'pull', pull);
  createDataProperty(underlyingSource2, 'cancel', cancel2);
  const branch2Stream = new ReadableStream(underlyingSource2);

  pull._branch1 = branch1Stream._readableStreamController;
  pull._branch2 = branch2Stream._readableStreamController;

  reader._closedPromise.catch(r => {
    if (teeState.closedOrErrored === true) {
      return undefined;
    }

    ReadableStreamDefaultControllerError(pull._branch1, r);
    ReadableStreamDefaultControllerError(pull._branch2, r);
    teeState.closedOrErrored = true;
  });

  return [branch1Stream, branch2Stream];
}

function create_ReadableStreamTeePullFunction() {
  const f = () => {
    const { _reader: reader, _branch1: branch1, _branch2: branch2, _teeState: teeState,
            _shouldClone: shouldClone } = f;

    return ReadableStreamDefaultReaderRead(reader).then(result => {
      assert(typeIsObject(result));
      const value = result.value;
      const done = result.done;
      assert(typeof done === "boolean");

      if (done === true && teeState.closedOrErrored === false) {
        if (teeState.canceled1 === false) {
          ReadableStreamDefaultControllerClose(branch1);
        }
        if (teeState.canceled2 === false) {
          ReadableStreamDefaultControllerClose(branch2);
        }
        teeState.closedOrErrored = true;
      }

      if (teeState.closedOrErrored === true) {
        return undefined;
      }

      // There is no way to access the cloning code right now in the reference implementation.
      // If we add one then we'll need an implementation for StructuredClone.


      if (teeState.canceled1 === false) {
        let value1 = value;
//        if (shouldClone === true) {
//          value1 = StructuredClone(value);
//        }
        ReadableStreamDefaultControllerEnqueue(branch1, value1);
      }

      if (teeState.canceled2 === false) {
        let value2 = value;
//        if (shouldClone === true) {
//          value2 = StructuredClone(value);
//        }
        ReadableStreamDefaultControllerEnqueue(branch2, value2);
      }
    });
  };
  return f;
}

function create_ReadableStreamTeeBranch1CancelFunction() {
  const f = reason => {
    const { _stream: stream, _teeState: teeState } = f;

    teeState.canceled1 = true;
    teeState.reason1 = reason;
    if (teeState.canceled2 === true) {
      const compositeReason = createArrayFromList([teeState.reason1, teeState.reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      teeState._resolve(cancelResult);
    }
    return teeState.promise;
  };
  return f;
}

function create_ReadableStreamTeeBranch2CancelFunction() {
  const f = reason => {
    const { _stream: stream, _teeState: teeState } = f;

    teeState.canceled2 = true;
    teeState.reason2 = reason;
    if (teeState.canceled1 === true) {
      const compositeReason = createArrayFromList([teeState.reason1, teeState.reason2]);
      const cancelResult = ReadableStreamCancel(stream, compositeReason);
      teeState._resolve(cancelResult);
    }
    return teeState.promise;
  };
  return f;
}

// ReadableStream API exposed for controllers.

function ReadableStreamAddReadIntoRequest(stream) {
  assert(IsReadableStreamBYOBReader(stream._reader) === true);

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
  assert(stream !== undefined);

  stream._disturbed = true;

  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  ReadableStreamClose(stream);

  const sourceCancelPromise = stream._readableStreamController[InternalCancel](reason);
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

  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;

  return undefined;
}

function ReadableStreamError(stream, e) {
  assert(IsReadableStream(stream) === true, 'stream must be ReadableStream');
  assert(stream._state === 'readable', 'state must be readable');

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
    assert(IsReadableStreamBYOBReader(reader), 'reader must be ReadableStreamBYOBReader');

    for (const readIntoRequest of reader._readIntoRequests) {
      readIntoRequest._reject(e);
    }

    reader._readIntoRequests = [];
  }

  reader._closedPromise_reject(e);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
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

function ReadableStreamHasReader(stream) {
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
      return Promise.reject(
        new TypeError('ReadableStreamDefaultReader.prototype.closed can only be used on a ReadableStreamDefaultReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (IsReadableStreamDefaultReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamDefaultReader.prototype.cancel can only be used on a ReadableStreamDefaultReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot cancel a stream using a released reader'));
    }

    return ReadableStreamReaderGenericCancel(this, reason);
  }

  read() {
    if (IsReadableStreamDefaultReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamDefaultReader.prototype.read can only be used on a ReadableStreamDefaultReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot read from a released reader'));
    }

    return ReadableStreamDefaultReaderRead(this);
  }

  releaseLock() {
    if (IsReadableStreamDefaultReader(this) === false) {
      throw new TypeError('ReadableStreamDefaultReader.prototype.releaseLock can only be used on a ReadableStreamDefaultReader');
    }

    if (this._ownerReadableStream === undefined) {
      return undefined;
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
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    ReadableStreamReaderGenericInitialize(this, stream);

    this._readIntoRequests = [];
  }

  get closed() {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableStreamBYOBReader.prototype.closed can only be used on a ReadableStreamBYOBReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableStreamBYOBReader.prototype.cancel can only be used on a ReadableStreamBYOBReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot cancel a stream using a released reader'));
    }

    return ReadableStreamReaderGenericCancel(this, reason);
  }

  read(view) {
    if (!IsReadableStreamBYOBReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableStreamBYOBReader.prototype.read can only be used on a ReadableStreamBYOBReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot read from a released reader'));
    }

    if (!ArrayBuffer.isView(view)) {
      return Promise.reject(new TypeError('view must be an array buffer view'));
    }

    if (view.byteLength === 0) {
      return Promise.reject(new TypeError('view must have non-zero byteLength'));
    }

    return ReadableStreamBYOBReaderRead(this, view);
  }

  releaseLock() {
    if (!IsReadableStreamBYOBReader(this)) {
      throw new TypeError(
          'ReadableStreamBYOBReader.prototype.releaseLock can only be used on a ReadableStreamBYOBReader');
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
    reader._closedPromise = new Promise((resolve, reject) => {
      reader._closedPromise_resolve = resolve;
      reader._closedPromise_reject = reject;
    });
  } else {
    if (stream._state === 'closed') {
      reader._closedPromise = Promise.resolve(undefined);
      reader._closedPromise_resolve = undefined;
      reader._closedPromise_reject = undefined;
    } else {
      assert(stream._state === 'errored', 'state must be errored');

      reader._closedPromise = Promise.reject(stream._storedError);
      reader._closedPromise_resolve = undefined;
      reader._closedPromise_reject = undefined;
    }
  }
}

// A client of ReadableStreamDefaultReader and ReadableStreamBYOBReader may use these functions directly to bypass state check.

function ReadableStreamReaderGenericCancel(reader, reason) {
  return ReadableStreamCancel(reader._ownerReadableStream, reason);
}

function ReadableStreamReaderGenericRelease(reader) {
  assert(reader._ownerReadableStream._reader !== undefined);
  assert(reader._ownerReadableStream !== undefined);

  if (reader._ownerReadableStream._state === 'readable') {
    reader._closedPromise_reject(
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
  } else {
    reader._closedPromise = Promise.reject(
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
  }

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
  return ReadableStreamBYOBControllerPullInto(stream._readableStreamController, view);
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

  return stream._readableStreamController[InternalPull]();
}

// Controllers

class ReadableStreamDefaultController {
  constructor(stream, underlyingSource, size, highWaterMark) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamDefaultController can only be constructed with a ReadableStream instance');
    }

    if (stream._readableStreamController !== undefined) {
      throw new TypeError('ReadableStreamDefaultController instances can only be created by the ReadableStream constructor');
    }

    this._controlledReadableStream = stream;

    this._underlyingSource = underlyingSource;

    this._queue = [];
    this._started = false;
    this._closeRequested = false;
    this._pullAgain = false;
    this._pulling = false;

    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(size, highWaterMark);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    const controller = this;

    const startResult = InvokeOrNoop(underlyingSource, 'start', [this]);
    Promise.resolve(startResult).then(
      () => {
        controller._started = true;
        ReadableStreamDefaultControllerCallPullIfNeeded(controller);
      },
      r => {
        if (stream._state === 'readable') {
          ReadableStreamDefaultControllerError(controller, r);
        }
      }
    )
    .catch(rethrowAssertionErrorRejection);
  }

  get desiredSize() {
    if (IsReadableStreamDefaultController(this) === false) {
      throw new TypeError(
        'ReadableStreamDefaultController.prototype.desiredSize can only be used on a ReadableStreamDefaultController');
    }

    return ReadableStreamDefaultControllerGetDesiredSize(this);
  }

  close() {
    if (IsReadableStreamDefaultController(this) === false) {
      throw new TypeError('ReadableStreamDefaultController.prototype.close can only be used on a ReadableStreamDefaultController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream (in ${stream._state} state) is not in the readable state and cannot be closed`);
    }

    ReadableStreamDefaultControllerClose(this);
  }

  enqueue(chunk) {
    if (IsReadableStreamDefaultController(this) === false) {
      throw new TypeError('ReadableStreamDefaultController.prototype.enqueue can only be used on a ReadableStreamDefaultController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(
          `The stream (in ${stream._state} state) is not in the readable state and cannot be enqueued to`);
    }

    return ReadableStreamDefaultControllerEnqueue(this, chunk);
  }

  error(e) {
    if (IsReadableStreamDefaultController(this) === false) {
      throw new TypeError('ReadableStreamDefaultController.prototype.error can only be used on a ReadableStreamDefaultController');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    ReadableStreamDefaultControllerError(this, e);
  }

  [InternalCancel](reason) {
    this._queue = [];

    return PromiseInvokeOrNoop(this._underlyingSource, 'cancel', [reason]);
  }

  [InternalPull]() {
    const stream = this._controlledReadableStream;

    if (this._queue.length > 0) {
      const chunk = DequeueValue(this._queue);

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

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingSource')) {
    return false;
  }

  return true;
}

function ReadableStreamDefaultControllerCallPullIfNeeded(controller) {
  const shouldPull = ReadableStreamDefaultControllerShouldPull(controller);
  if (shouldPull === false) {
    return undefined;
  }

  if (controller._pulling === true) {
    controller._pullAgain = true;
    return undefined;
  }

  controller._pulling = true;

  const stream = controller._controlledReadableStream;

  const pullPromise = PromiseInvokeOrNoop(controller._underlyingSource, 'pull', [controller]);
  pullPromise.then(
    () => {
      controller._pulling = false;

      if (controller._pullAgain === true) {
        controller._pullAgain = false;
        return ReadableStreamDefaultControllerCallPullIfNeeded(controller);
      }
    },
    e => {
      if (stream._state === 'readable') {
        return ReadableStreamDefaultControllerError(controller, e);
      }
    }
  )
  .catch(rethrowAssertionErrorRejection);

  return undefined;
}

function ReadableStreamDefaultControllerShouldPull(controller) {
  const stream = controller._controlledReadableStream;

  if (stream._state === 'closed' || stream._state === 'errored') {
    return false;
  }

  if (controller._closeRequested === true) {
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

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  controller._closeRequested = true;

  if (controller._queue.length === 0) {
    ReadableStreamClose(stream);
  }
}

function ReadableStreamDefaultControllerEnqueue(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  if (IsReadableStreamLocked(stream) === true && ReadableStreamGetNumReadRequests(stream) > 0) {
    ReadableStreamFulfillReadRequest(stream, chunk, false);
  } else {
    let chunkSize = 1;

    if (controller._strategySize !== undefined) {
      try {
        chunkSize = controller._strategySize(chunk);
      } catch (chunkSizeE) {
        if (stream._state === 'readable') {
          ReadableStreamDefaultControllerError(controller, chunkSizeE);
        }
        throw chunkSizeE;
      }
    }

    try {
      EnqueueValueWithSize(controller._queue, chunk, chunkSize);
    } catch (enqueueE) {
      if (stream._state === 'readable') {
        ReadableStreamDefaultControllerError(controller, enqueueE);
      }
      throw enqueueE;
    }
  }

  ReadableStreamDefaultControllerCallPullIfNeeded(controller);

  return undefined;
}

function ReadableStreamDefaultControllerError(controller, e) {
  const stream = controller._controlledReadableStream;

  assert(stream._state === 'readable');

  controller._queue = [];

  ReadableStreamError(stream, e);
}

function ReadableStreamDefaultControllerGetDesiredSize(controller) {
  const queueSize = GetTotalQueueSize(controller._queue);
  return controller._strategyHWM - queueSize;
}

class ReadableStreamBYOBRequest {
  constructor(controller, descriptor) {
    this._associatedReadableStreamBYOBController = controller;
    this._view = new Uint8Array(descriptor.buffer,
                                descriptor.byteOffset + descriptor.bytesFilled,
                                descriptor.byteLength - descriptor.bytesFilled);
  }

  get view() {
    return this._view;
  }

  respond(bytesWritten) {
    if (IsReadableStreamBYOBRequest(this) === false) {
      throw new TypeError(
          'ReadableStreamBYOBController.prototype.respond can only be used on a ReadableStreamBYOBController');
    }

    if (this._associatedReadableStreamBYOBController === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    ReadableStreamBYOBControllerRespond(this._associatedReadableStreamBYOBController, bytesWritten);
  }

  respondWithNewView(view) {
    if (IsReadableStreamBYOBRequest(this) === false) {
      throw new TypeError(
          'ReadableStreamBYOBController.prototype.respond can only be used on a ReadableStreamBYOBController');
    }

    if (this._associatedReadableStreamBYOBController === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    if (!ArrayBuffer.isView(view)) {
      throw new TypeError('You can only respond with array buffer views');
    }

    ReadableStreamBYOBControllerRespondWithNewView(this._associatedReadableStreamBYOBController, view);
  }

  _invalidate() {
    this._associatedReadableStreamBYOBController = undefined;
    this._view = undefined;
  }
}

class ReadableStreamBYOBController {
  constructor(controlledReadableStream, underlyingByteSource, highWaterMark) {
    if (IsReadableStream(controlledReadableStream) === false) {
      throw new TypeError('ReadableStreamBYOBController can only be constructed with a ReadableStream instance given ' +
          'a byte source');
    }

    if (controlledReadableStream._readableStreamController !== undefined) {
      throw new TypeError(
          'ReadableStreamBYOBController instances can only be created by the ReadableStream constructor given a byte ' +
              'source');
    }

    this._controlledReadableStream = controlledReadableStream;

    this._underlyingByteSource = underlyingByteSource;

    this._pullAgain = false;
    this._pulling = false;

    ReadableStreamBYOBControllerClearPendingPullIntos(this);

    this._queue = [];
    this._totalQueuedBytes = 0;

    this._closeRequested = false;

    this._started = false;

    this._strategyHWM = ValidateAndNormalizeHighWaterMark(highWaterMark);

    const autoAllocateChunkSize = underlyingByteSource['autoAllocateChunkSize'];
    if (autoAllocateChunkSize !== undefined) {
      if (Number.isInteger(autoAllocateChunkSize) === false || autoAllocateChunkSize < 0) {
        throw new RangeError("autoAllocateChunkSize must be a non negative integer");
      }
    }
    this._autoAllocateChunkSize = autoAllocateChunkSize;

    this._pendingPullIntos = [];

    const controller = this;

    const startResult = InvokeOrNoop(underlyingByteSource, 'start', [this]);
    Promise.resolve(startResult).then(
      () => {
        controller._started = true;

        assert(controller._pulling === false);
        assert(controller._pullAgain === false);

        ReadableStreamBYOBControllerCallPullIfNeeded(controller);
      },
      r => {
        if (controlledReadableStream._state === 'readable') {
          ReadableStreamBYOBControllerError(controller, r);
        }
      }
    )
    .catch(rethrowAssertionErrorRejection);
  }

  get byobRequest() {
    if (IsReadableStreamBYOBController(this) === false) {
      throw new TypeError(
        'ReadableStreamBYOBController.prototype.byobRequest can only be used on a ReadableStreamBYOBController');
    }

    if (this._byobRequest === undefined && this._pendingPullIntos.length > 0) {
      const firstDescriptor = this._pendingPullIntos[0];
      this._byobRequest = new ReadableStreamBYOBRequest(this, firstDescriptor);
    }

    return this._byobRequest;
  }

  get desiredSize() {
    if (IsReadableStreamBYOBController(this) === false) {
      throw new TypeError(
        'ReadableStreamBYOBController.prototype.desiredSize can only be used on a ReadableStreamBYOBController');
    }

    return ReadableStreamBYOBControllerGetDesiredSize(this);
  }

  close() {
    if (IsReadableStreamBYOBController(this) === false) {
      throw new TypeError(
          'ReadableStreamBYOBController.prototype.close can only be used on a ReadableStreamBYOBController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be closed');
    }

    ReadableStreamBYOBControllerClose(this);
  }

  enqueue(chunk) {
    if (IsReadableStreamBYOBController(this) === false) {
      throw new TypeError(
          'ReadableStreamBYOBController.prototype.enqueue can only be used on a ReadableStreamBYOBController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be enqueued to');
    }

    if (!ArrayBuffer.isView(chunk)) {
      throw new TypeError('You can only enqueue array buffer views when using a ReadableStreamBYOBController');
    }

    ReadableStreamBYOBControllerEnqueue(this, chunk);
  }

  error(e) {
    if (IsReadableStreamBYOBController(this) === false) {
      throw new TypeError(
          'ReadableStreamBYOBController.prototype.error can only be used on a ReadableStreamBYOBController');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    ReadableStreamBYOBControllerError(this, e);
  }

  [InternalCancel](reason) {
    if (this._pendingPullIntos.length > 0) {
      const firstDescriptor = this._pendingPullIntos[0];
      firstDescriptor.bytesFilled = 0;
    }

    this._queue = [];
    this._totalQueuedBytes = 0;

    return PromiseInvokeOrNoop(this._underlyingByteSource, 'cancel', [reason]);
  }

  [InternalPull]() {
    const stream = this._controlledReadableStream;

    if (ReadableStreamGetNumReadRequests(stream) === 0) {
      if (this._totalQueuedBytes > 0) {
        const entry = this._queue.shift();
        this._totalQueuedBytes -= entry.byteLength;

        ReadableStreamBYOBControllerHandleQueueDrain(this);

        const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
        return Promise.resolve(CreateIterResultObject(view, false));
      }

      const autoAllocateChunkSize = this._autoAllocateChunkSize;
      if (autoAllocateChunkSize !== undefined) {
        const buffer = new ArrayBuffer(autoAllocateChunkSize);

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
    } else {
      assert(this._autoAllocateChunkSize === undefined);
    }

    const promise = ReadableStreamAddReadRequest(stream);

    ReadableStreamBYOBControllerCallPullIfNeeded(this);

    return promise;
  }
}

// Abstract operations for the ReadableStreamBYOBController.

function IsReadableStreamBYOBController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingByteSource')) {
    return false;
  }

  return true;
}

function IsReadableStreamBYOBRequest(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_associatedReadableStreamBYOBController')) {
    return false;
  }

  return true;
}

function ReadableStreamBYOBControllerCallPullIfNeeded(controller) {
  const shouldPull = ReadableStreamBYOBControllerShouldCallPull(controller);
  if (shouldPull === false) {
    return undefined;
  }

  if (controller._pulling === true) {
    controller._pullAgain = true;
    return undefined;
  }

  controller._pullAgain = false;

  controller._pulling = true;

  // TODO: Test controller argument
  const pullPromise = PromiseInvokeOrNoop(controller._underlyingByteSource, 'pull', [controller]);
  pullPromise.then(
    () => {
      controller._pulling = false;

      if (controller._pullAgain === true) {
        controller._pullAgain = false;
        ReadableStreamBYOBControllerCallPullIfNeeded(controller);
      }
    },
    e => {
      if (controller._controlledReadableStream._state === 'readable') {
        ReadableStreamBYOBControllerError(controller, e);
      }
    }
  )
  .catch(rethrowAssertionErrorRejection);

  return undefined;
}

function ReadableStreamBYOBControllerClearPendingPullIntos(controller) {
  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }
  controller._pendingPullIntos = [];
}

function ReadableStreamBYOBControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor) {
  assert(stream._state !== 'errored', 'state must not be errored');

  let done = false;
  if (stream._state === 'closed') {
    assert(pullIntoDescriptor.bytesFilled === 0);
    done = true;
  }

  const filledView = ReadableStreamBYOBControllerConvertPullIntoDescriptor(pullIntoDescriptor);
  if (pullIntoDescriptor.readerType === 'default') {
    ReadableStreamFulfillReadRequest(stream, filledView, done);
  } else {
    assert(pullIntoDescriptor.readerType === 'byob');
    ReadableStreamFulfillReadIntoRequest(stream, filledView, done);
  }
}

function ReadableStreamBYOBControllerConvertPullIntoDescriptor(pullIntoDescriptor) {
  const bytesFilled = pullIntoDescriptor.bytesFilled;
  const elementSize = pullIntoDescriptor.elementSize;

  assert(bytesFilled <= pullIntoDescriptor.byteLength);
  assert(bytesFilled % elementSize === 0);

  return new pullIntoDescriptor.ctor(
      pullIntoDescriptor.buffer, pullIntoDescriptor.byteOffset, bytesFilled / elementSize);
}

function ReadableStreamBYOBControllerEnqueueChunkToQueue(controller, buffer, byteOffset, byteLength) {
  controller._queue.push({buffer, byteOffset, byteLength});
  controller._totalQueuedBytes += byteLength;
}

function ReadableStreamBYOBControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) {
  const elementSize = pullIntoDescriptor.elementSize;

  const currentAlignedBytes = pullIntoDescriptor.bytesFilled - pullIntoDescriptor.bytesFilled % elementSize;

  const maxBytesToCopy = Math.min(controller._totalQueuedBytes,
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
    controller._totalQueuedBytes -= bytesToCopy;

    ReadableStreamBYOBControllerFillHeadPullIntoDescriptor(controller, bytesToCopy, pullIntoDescriptor);

    totalBytesToCopyRemaining -= bytesToCopy
  }

  if (ready === false) {
    assert(controller._totalQueuedBytes === 0, 'queue must be empty');
    assert(pullIntoDescriptor.bytesFilled > 0);
    assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }

  return ready;
}

function ReadableStreamBYOBControllerFillHeadPullIntoDescriptor(controller, size, pullIntoDescriptor) {
  assert(controller._pendingPullIntos.length === 0 || controller._pendingPullIntos[0] === pullIntoDescriptor);

  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }

  pullIntoDescriptor.bytesFilled += size;
}

function ReadableStreamBYOBControllerHandleQueueDrain(controller) {
  assert(controller._controlledReadableStream._state === 'readable');

  if (controller._totalQueuedBytes === 0 && controller._closeRequested === true) {
    ReadableStreamClose(controller._controlledReadableStream);
  } else {
    ReadableStreamBYOBControllerCallPullIfNeeded(controller);
  }
}

function ReadableStreamBYOBControllerProcessPullIntoDescriptorsUsingQueue(controller) {
  assert(controller._closeRequested === false);

  while (controller._pendingPullIntos.length > 0) {
    if (controller._totalQueuedBytes === 0) {
      return;
    }

    const pullIntoDescriptor = controller._pendingPullIntos[0];

    if (ReadableStreamBYOBControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) === true) {
      ReadableStreamBYOBControllerShiftPendingPullInto(controller);

      ReadableStreamBYOBControllerCommitPullIntoDescriptor(controller._controlledReadableStream, pullIntoDescriptor);
    }
  }
}

function ReadableStreamBYOBControllerPullInto(controller, view) {
  const stream = controller._controlledReadableStream;

  let elementSize = 1;
  if (view.constructor !== DataView) {
    elementSize = view.constructor.BYTES_PER_ELEMENT;
  }

  const ctor = view.constructor;

  const pullIntoDescriptor = {
    buffer: view.buffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    bytesFilled: 0,
    elementSize,
    ctor,
    readerType: 'byob'
  };

  if (controller._pendingPullIntos.length > 0) {
    pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);;
    controller._pendingPullIntos.push(pullIntoDescriptor);

    // No ReadableStreamBYOBControllerCallPullIfNeeded() call since:
    // - No change happens on desiredSize
    // - The source has already been notified of that there's at least 1 pending read(view)

    return ReadableStreamAddReadIntoRequest(stream);
  }

  if (stream._state === 'closed') {
    const emptyView = new view.constructor(view.buffer, view.byteOffset, 0);
    return Promise.resolve(CreateIterResultObject(emptyView, true));
  }

  if (controller._totalQueuedBytes > 0) {
    if (ReadableStreamBYOBControllerFillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) === true) {
      const filledView = ReadableStreamBYOBControllerConvertPullIntoDescriptor(pullIntoDescriptor);

      ReadableStreamBYOBControllerHandleQueueDrain(controller);

      return Promise.resolve(CreateIterResultObject(filledView, false));
    }

    if (controller._closeRequested === true) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ReadableStreamBYOBControllerError(controller, e)

      return Promise.reject(e);
    }
  }

  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  controller._pendingPullIntos.push(pullIntoDescriptor);

  const promise = ReadableStreamAddReadIntoRequest(stream);

  ReadableStreamBYOBControllerCallPullIfNeeded(controller);

  return promise;
}

function ReadableStreamBYOBControllerRespondInClosedState(controller, firstDescriptor) {
  firstDescriptor.buffer = TransferArrayBuffer(firstDescriptor.buffer);

  assert(firstDescriptor.bytesFilled === 0, 'bytesFilled must be 0');

  const stream = controller._controlledReadableStream;

  while (ReadableStreamGetNumReadIntoRequests(stream) > 0) {
    const pullIntoDescriptor = ReadableStreamBYOBControllerShiftPendingPullInto(controller);

    ReadableStreamBYOBControllerCommitPullIntoDescriptor(stream, pullIntoDescriptor);
  }
}

function ReadableStreamBYOBControllerRespondInReadableState(controller, bytesWritten, pullIntoDescriptor) {
  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
    throw new RangeError('bytesWritten out of range');
  }

  ReadableStreamBYOBControllerFillHeadPullIntoDescriptor(controller, bytesWritten, pullIntoDescriptor);

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    // TODO: Figure out whether we should detach the buffer or not here.
    return;
  }

  ReadableStreamBYOBControllerShiftPendingPullInto(controller);

  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, end);
    ReadableStreamBYOBControllerEnqueueChunkToQueue(controller, remainder, 0, remainder.byteLength);
  }

  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  pullIntoDescriptor.bytesFilled -= remainderSize;
  ReadableStreamBYOBControllerCommitPullIntoDescriptor(controller._controlledReadableStream, pullIntoDescriptor);

  ReadableStreamBYOBControllerProcessPullIntoDescriptorsUsingQueue(controller);
}

function ReadableStreamBYOBControllerRespondInternal(controller, bytesWritten) {
  const firstDescriptor = controller._pendingPullIntos[0];

  const stream = controller._controlledReadableStream;

  if (stream._state === 'closed') {
    if (bytesWritten !== 0) {
      throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
    }

    ReadableStreamBYOBControllerRespondInClosedState(controller, firstDescriptor);
  } else {
    assert(stream._state === 'readable');

    ReadableStreamBYOBControllerRespondInReadableState(controller, bytesWritten, firstDescriptor);
  }
}

function ReadableStreamBYOBControllerShiftPendingPullInto(controller) {
  const descriptor = controller._pendingPullIntos.shift();
  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }
  return descriptor;
}

function ReadableStreamBYOBControllerShouldCallPull(controller) {
  const stream = controller._controlledReadableStream;

  if (stream._state !== 'readable') {
    return false;
  }

  if (controller._closeRequested === true) {
    return false;
  }

  if (controller._started === false) {
    return false;
  }

  if (ReadableStreamHasReader(stream) && ReadableStreamGetNumReadRequests(stream) > 0) {
    return true;
  }

  if (ReadableStreamHasBYOBReader(stream) && ReadableStreamGetNumReadIntoRequests(stream) > 0) {
    return true;
  }

  const desiredSize = ReadableStreamBYOBControllerGetDesiredSize(controller);
  if (desiredSize > 0) {
    return true;
  }

  return false;
}

// A client of ReadableStreamBYOBController may use these functions directly to bypass state check.

function ReadableStreamBYOBControllerClose(controller) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  if (controller._totalQueuedBytes > 0) {
    controller._closeRequested = true;

    return;
  }

  const firstPendingPullInto = controller._pendingPullIntos[0];
  if (ReadableStreamHasBYOBReader(stream) === true &&
      controller._pendingPullIntos.length > 0 &&
      firstPendingPullInto.bytesFilled > 0) {
    const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
    ReadableStreamBYOBControllerError(controller, e);

    throw e;
  }

  ReadableStreamClose(stream);
}

function ReadableStreamBYOBControllerEnqueue(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  const buffer = chunk.buffer;
  const byteOffset = chunk.byteOffset;
  const byteLength = chunk.byteLength;

  if (ReadableStreamHasReader(stream) === true) {
    if (ReadableStreamGetNumReadRequests(stream) === 0) {
      const transferredBuffer = TransferArrayBuffer(buffer);
      ReadableStreamBYOBControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    } else {
      assert(controller._queue.length === 0);

      const transferredBuffer = TransferArrayBuffer(buffer);
      const transferredView = new Uint8Array(transferredBuffer, byteOffset, byteLength);
      ReadableStreamFulfillReadRequest(stream, transferredView, false);
    }
  } else {
    if (ReadableStreamHasBYOBReader(stream) === true) {
      // TODO: Ideally this detaching should happen only if the buffer is not consumed fully.
      const transferredBuffer = TransferArrayBuffer(buffer);
      ReadableStreamBYOBControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
      ReadableStreamBYOBControllerProcessPullIntoDescriptorsUsingQueue(controller);
    } else {
      assert(IsReadableStreamLocked(stream) === false, 'stream must not be locked');
      const transferredBuffer = TransferArrayBuffer(buffer);
      ReadableStreamBYOBControllerEnqueueChunkToQueue(controller, transferredBuffer, byteOffset, byteLength);
    }
  }
}

function ReadableStreamBYOBControllerError(controller, e) {
  const stream = controller._controlledReadableStream;

  assert(stream._state === 'readable');

  ReadableStreamBYOBControllerClearPendingPullIntos(controller);

  controller._queue = [];

  ReadableStreamError(stream, e);
}

function ReadableStreamBYOBControllerGetDesiredSize(controller) {
  return controller._strategyHWM - controller._totalQueuedBytes;
}

function ReadableStreamBYOBControllerRespond(controller, bytesWritten) {
  bytesWritten = Number(bytesWritten);
  if (IsFiniteNonNegativeNumber(bytesWritten) === false) {
    throw new RangeError('bytesWritten must be a finite')
  }

  assert(controller._pendingPullIntos.length > 0);

  ReadableStreamBYOBControllerRespondInternal(controller, bytesWritten);
}

function ReadableStreamBYOBControllerRespondWithNewView(controller, view) {
  assert(controller._pendingPullIntos.length > 0);

  const firstDescriptor = controller._pendingPullIntos[0];

  if (firstDescriptor.byteOffset + firstDescriptor.bytesFilled !== view.byteOffset) {
    throw new RangeError('The region specified by view does not match byobRequest');
  }
  if (firstDescriptor.byteLength !== view.byteLength) {
    throw new RangeError('The buffer of view has different capacity than byobRequest');
  }

  firstDescriptor.buffer = view.buffer;

  ReadableStreamBYOBControllerRespondInternal(controller, view.byteLength);
}
