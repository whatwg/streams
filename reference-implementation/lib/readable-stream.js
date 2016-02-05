const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, TransferArrayBuffer,
         ValidateAndNormalizeQueuingStrategy, ValidateAndNormalizeHighWaterMark } from './helpers';
import { createArrayFromList, createDataProperty, isFiniteNonNegativeNumber, typeIsObject } from './helpers';
import { rethrowAssertionErrorRejection } from './utils';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';

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
    if (underlyingSource['byob'] === true) {
      if (highWaterMark === undefined) {
        highWaterMark = 0;
      }
      this._readableStreamController = new ReadableByteStreamController(this, underlyingSource, highWaterMark);
    } else {
      if (highWaterMark === undefined) {
        highWaterMark = 1;
      }
      this._readableStreamController = new ReadableStreamController(this, underlyingSource, size, highWaterMark);
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

    return CancelReadableStream(this, reason);
  }

  getBYOBReader() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableByteStream.prototype.getBYOBReader can only be used on a ReadableByteStream');
    }

    if (IsReadableByteStreamController(this._readableStreamController) === false) {
      throw new TypeError('Cannot get a ReadableStreamBYOBReader for a stream not constructed with a byte source');
    }

    return AcquireReadableStreamBYOBReader(this);
  }

  getReader() {
    if (IsReadableStream(this) === false) {
      throw new TypeError('ReadableStream.prototype.getReader can only be used on a ReadableStream');
    }

    return AcquireReadableStreamReader(this);
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

    const branches = TeeReadableStream(this, false);
    return createArrayFromList(branches);
  }
}

// Readers

class ReadableStreamReader {
  constructor(stream) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamReader can only be constructed with a ReadableStream instance');
    }
    if (IsReadableStreamLocked(stream) === true) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    InitializeReadableStreamReaderGeneric(this, stream);

    this._readRequests = [];
  }

  get closed() {
    if (IsReadableStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.closed can only be used on a ReadableStreamReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (IsReadableStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.cancel can only be used on a ReadableStreamReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot cancel a stream using a released reader'));
    }

    return CancelReadableStream(this._ownerReadableStream, reason);
  }

  read() {
    if (IsReadableStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.read can only be used on a ReadableStreamReader'));
    }

    if (this._ownerReadableStream === undefined) {
      return Promise.reject(new TypeError('Cannot read from a released reader'));
    }

    return ReadFromReadableStreamReader(this);
  }

  releaseLock() {
    if (IsReadableStreamReader(this) === false) {
      throw new TypeError('ReadableStreamReader.prototype.releaseLock can only be used on a ReadableStreamReader');
    }

    if (this._ownerReadableStream === undefined) {
      return undefined;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    ReleaseReadableStreamReader(this);
  }
}

class ReadableStreamBYOBReader {
  constructor(stream) {
    if (!IsReadableStream(stream)) {
      throw new TypeError('ReadableStreamBYOBReader can only be constructed with a ReadableByteStream instance');
    }
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    InitializeReadableStreamReaderGeneric(this, stream);

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

    return CancelReadableStream(this._ownerReadableStream, reason);
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

    const stream = this._ownerReadableStream;

    stream._disturbed = true;

    if (view === undefined || !ArrayBuffer.isView(view)) {
      return Promise.reject(new TypeError('Valid view must be provided'));
    }

    const ctor = view.constructor;
    let elementSize = 1;
    if (ctor === Int16Array || ctor === Uint16Array || ctor === Int32Array || ctor === Uint32Array ||
        ctor === Float32Array || ctor === Float64Array || ctor === Int8Array || ctor === Uint8Array ||
        ctor === Uint8ClampedArray) {
      elementSize = ctor.BYTES_PER_ELEMENT;
    } else if (ctor !== DataView) {
      return Promise.reject(new TypeError('view is of an unsupported type'));
    }

    if (view.byteLength === 0) {
      return Promise.reject(new TypeError('view must have non-zero byteLength'));
    }

    if (stream._state === 'errored') {
      return Promise.reject(stream._storedError);
    }

    // Controllers must implement this.
    return PullFromReadableByteStreamControllerInto(
        stream._readableStreamController, view.buffer, view.byteOffset, view.byteLength, ctor, elementSize);
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

    ReleaseReadableStreamReader(this);
  }
}

// Controllers

class ReadableStreamController {
  constructor(stream, underlyingSource, size, highWaterMark) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamController can only be constructed with a ReadableStream instance');
    }

    if (stream._readableStreamController !== undefined) {
      throw new TypeError('ReadableStreamController instances can only be created by the ReadableStream constructor');
    }

    this._controlledReadableStream = stream;

    this._underlyingSource = underlyingSource;

    this._queue = [];
    this._started = false;
    this._closeRequested = false;
    this._pulling = false;
    this._pullAgain = false;

    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(size, highWaterMark);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    const controller = this;

    const startResult = InvokeOrNoop(underlyingSource, 'start', [this]);
    Promise.resolve(startResult).then(
      () => {
        controller._started = true;
        ReadableStreamControllerCallPullIfNeeded(controller);
      },
      r => {
        if (stream._state === 'readable') {
          return ErrorReadableStreamController(controller, r);
        }
      }
    )
    .catch(rethrowAssertionErrorRejection);
  }

  get desiredSize() {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError(
        'ReadableStreamController.prototype.desiredSize can only be used on a ReadableStreamController');
    }

    return GetReadableStreamControllerDesiredSize(this);
  }

  close() {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.close can only be used on a ReadableStreamController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream (in ${stream._state} state) is not in the readable state and cannot be closed`);
    }

    return CloseReadableStreamController(this);
  }

  enqueue(chunk) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.enqueue can only be used on a ReadableStreamController');
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(
          `The stream (in ${stream._state} state) is not in the readable state and cannot be enqueued to`);
    }

    return EnqueueInReadableStreamController(this, chunk);
  }

  error(e) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.error can only be used on a ReadableStreamController');
    }

    const stream = this._controlledReadableStream;
    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    return ErrorReadableStreamController(this, e);
  }

  _cancel(reason) {
    this._queue = [];

    return PromiseInvokeOrNoop(this._underlyingSource, 'cancel', [reason]);
  }

  _pull() {
    const stream = this._controlledReadableStream;

    if (this._queue.length > 0) {
      const chunk = DequeueValue(this._queue);

      if (this._closeRequested === true && this._queue.length === 0) {
        CloseReadableStream(stream);
      } else {
        ReadableStreamControllerCallPullIfNeeded(this);
      }

      return Promise.resolve(CreateIterResultObject(chunk, false));
    }

    const pendingPromise = AddReadRequestToReadableStream(stream);
    ReadableStreamControllerCallPullIfNeeded(this);
    return pendingPromise;
  }
}

class ReadableStreamBYOBRequest {
  constructor(controller, descriptor) {
    this._associatedReadableByteStreamController = controller;
    this._view = new Uint8Array(descriptor.buffer,
                                descriptor.byteOffset + descriptor.bytesFilled,
                                descriptor.byteLength - descriptor.bytesFilled);
  }

  get view() {
    return this._view;
  }

  respond(bytesWritten, buffer) {
    if (!IsReadableStreamBYOBRequest(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.respond can only be used on a ReadableByteStreamController');
    }

    if (this._associatedReadableByteStreamController === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    RespondToReadableByteStreamController(this._associatedReadableByteStreamController, bytesWritten, buffer);
  }

  _invalidate() {
    this._associatedReadableByteStreamController = undefined;
    this._view = undefined;
  }
}

class ReadableByteStreamController {
  constructor(controlledReadableStream, underlyingByteSource, highWaterMark) {
    if (IsReadableStream(controlledReadableStream) === false) {
      throw new TypeError('ReadableByteStreamController can only be constructed with a ReadableByteStream instance');
    }

    if (controlledReadableStream._readableStreamController !== undefined) {
      throw new TypeError(
          'ReadableByteStreamController instances can only be created by the ReadableByteStream constructor');
    }

    this._controlledReadableStream = controlledReadableStream;

    this._underlyingByteSource = underlyingByteSource;

    this._pullAgain = false;
    this._pulling = false;

    ReadableByteStreamControllerClearPendingPullIntos(this);

    this._queue = [];
    this._totalQueuedBytes = 0;

    this._closeRequested = false;

    this._started = false;

    this._strategyHWM = ValidateAndNormalizeHighWaterMark(highWaterMark);

    const controller = this;

    const startResult = InvokeOrNoop(underlyingByteSource, 'start', [this]);
    Promise.resolve(startResult).then(
      () => {
        controller._started = true;
        controller._pullAgain = true;
        ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);
      },
      r => {
        if (controlledReadableStream._state === 'readable') {
          return ErrorReadableStreamController(controller, r);
        }
      }
    )
    .catch(rethrowAssertionErrorRejection);
  }

  get byobRequest() {
    if (this._byobRequest === undefined && this._pendingPullIntos.length > 0) {
      this._byobRequest = new ReadableStreamBYOBRequest(this, this._pendingPullIntos[0]);
    }

    return this._byobRequest;
  }

  get desiredSize() {
    if (IsReadableByteStreamController(this) === false) {
      throw new TypeError(
        'ReadableByteStreamController.prototype.desiredSize can only be used on a ReadableByteStreamController');
    }

    return GetReadableByteStreamControllerDesiredSize(this);
  }

  close() {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.close can only be used on a ReadableByteStreamController');
    }

    if (this._closeRequested) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be closed');
    }

    CloseReadableByteStreamController(this);
  }

  enqueue(chunk) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.enqueue can only be used on a ReadableByteStreamController');
    }

    if (this._closeRequested) {
      throw new TypeError('stream is closed or draining');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be enqueued to');
    }

    EnqueueInReadableByteStreamController(this, chunk);
  }

  error(e) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.error can only be used on a ReadableByteStreamController');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    ErrorReadableByteStreamController(this, e);
  }

  _cancel(reason) {
    if (this._pendingPullIntos.length > 0) {
      this._pendingPullIntos[0].bytesFilled = 0;
    }

    this._queue = [];
    this._totalQueuedBytes = 0;

    return PromiseInvokeOrNoop(this._underlyingByteSource, 'cancel', [reason]);
  }

  _pull() {
    const stream = this._controlledReadableStream;

    if (GetNumReadRequests(stream) >= 1) {
      const pendingPromise = AddReadRequestToReadableStream(stream);

      ReadableByteStreamControllerCallPullOnceAndThenRepeatIfNeeded(this);

      return pendingPromise;
    }

    if (this._totalQueuedBytes > 0) {
      const entry = this._queue.shift();
      this._totalQueuedBytes -= entry.byteLength;

      const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
      const promise = Promise.resolve(CreateIterResultObject(view, false));

      if (this._totalQueuedBytes === 0 && this._closeRequested) {
        CloseReadableStream(stream);
      } else {
        ReadableByteStreamControllerCallPullOnceAndThenRepeatIfNeeded(this);
      }

      return promise;
    }

    const promise = AddReadRequestToReadableStream(stream);

    ReadableByteStreamControllerCallPullOnceAndThenRepeatIfNeeded(this);

    return promise;
  }
}

// Utilities

export function IsReadableStreamDisturbed(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamDisturbed should only be used on known readable streams');

  return stream._disturbed;
}

// Abstract operations for the ReadableStream.

function AcquireReadableStreamBYOBReader(stream) {
  return new ReadableStreamBYOBReader(stream);
}

function AcquireReadableStreamReader(stream) {
  return new ReadableStreamReader(stream);
}

function TeeReadableStream(stream, shouldClone) {
  assert(IsReadableStream(stream) === true);
  assert(typeof shouldClone === 'boolean');

  const reader = AcquireReadableStreamReader(stream);

  const teeState = {
    closedOrErrored: false,
    canceled1: false,
    canceled2: false,
    reason1: undefined,
    reason2: undefined
  };
  teeState.promise = new Promise(resolve => teeState._resolve = resolve);

  const pull = create_TeeReadableStreamPullFunction();
  pull._reader = reader;
  pull._teeState = teeState;
  pull._shouldClone = shouldClone;

  const cancel1 = create_TeeReadableStreamBranch1CancelFunction();
  cancel1._stream = stream;
  cancel1._teeState = teeState;

  const cancel2 = create_TeeReadableStreamBranch2CancelFunction();
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

    ErrorReadableStreamController(pull._branch1, r);
    ErrorReadableStreamController(pull._branch2, r);
    teeState.closedOrErrored = true;
  });

  return [branch1Stream, branch2Stream];
}

function create_TeeReadableStreamPullFunction() {
  const f = () => {
    const { _reader: reader, _branch1: branch1, _branch2: branch2, _teeState: teeState,
            _shouldClone: shouldClone } = f;

    return ReadFromReadableStreamReader(reader).then(result => {
      assert(typeIsObject(result));
      const value = result.value;
      const done = result.done;
      assert(typeof done === "boolean");

      if (done === true && teeState.closedOrErrored === false) {
        if (teeState.canceled1 === false) {
          CloseReadableStreamController(branch1);
        }
        if (teeState.canceled2 === false) {
          CloseReadableStreamController(branch2);
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
        EnqueueInReadableStreamController(branch1, value1);
      }

      if (teeState.canceled2 === false) {
        let value2 = value;
//        if (shouldClone === true) {
//          value2 = StructuredClone(value);
//        }
        EnqueueInReadableStreamController(branch2, value2);
      }
    });
  };
  return f;
}

function create_TeeReadableStreamBranch1CancelFunction() {
  const f = reason => {
    const { _stream: stream, _teeState: teeState } = f;

    teeState.canceled1 = true;
    teeState.reason1 = reason;
    if (teeState.canceled2 === true) {
      const compositeReason = createArrayFromList([teeState.reason1, teeState.reason2]);
      const cancelResult = CancelReadableStream(stream, compositeReason);
      teeState._resolve(cancelResult);
    }
    return teeState.promise;
  };
  return f;
}

function create_TeeReadableStreamBranch2CancelFunction() {
  const f = reason => {
    const { _stream: stream, _teeState: teeState } = f;

    teeState.canceled2 = true;
    teeState.reason2 = reason;
    if (teeState.canceled1 === true) {
      const compositeReason = createArrayFromList([teeState.reason1, teeState.reason2]);
      const cancelResult = CancelReadableStream(stream, compositeReason);
      teeState._resolve(cancelResult);
    }
    return teeState.promise;
  };
  return f;
}

// Type checking helpers.

function IsReadableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readableStreamController')) {
    return false;
  }

  return true;
}

function IsReadableStreamReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readRequests')) {
    return false;
  }

  return true;
}

function IsReadableStreamBYOBReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readIntoRequests')) {
    return false;
  }

  return true;
}

function IsReadableStreamController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingSource')) {
    return false;
  }

  return true;
}

function IsReadableByteStreamController(x) {
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

  if (!Object.prototype.hasOwnProperty.call(x, '_associatedReadableByteStreamController')) {
    return false;
  }

  return true;
}

// ReadableStream API exposed for controllers.

function AddReadRequestToReadableStream(stream) {
  assert(IsReadableStreamReader(stream._reader));

  const readRequest = {};
  const promise = new Promise((resolve, reject) => {
    readRequest._resolve = resolve;
    readRequest._reject = reject;
  });

  stream._reader._readRequests.push(readRequest);

  return promise;
}

function AddReadIntoRequestToReadableStream(stream, byteOffset, byteLength, ctor, elementSize) {
  assert(IsReadableStreamBYOBReader(stream._reader));

  return new Promise((resolve, reject) => {
    const req = {
      resolve,
      reject,
      byteOffset,
      byteLength,
      ctor,
      elementSize
    };
    stream._reader._readIntoRequests.push(req);
  });
}

function CloseReadableStream(stream) {
  assert(stream._state === 'readable');

  stream._state = 'closed';

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableStreamReader(reader)) {
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

function ErrorReadableStream(stream, e) {
  assert(IsReadableStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'errored';
  stream._storedError = e;

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableStreamReader(reader)) {
    for (const req of reader._readRequests) {
      req._reject(e);
    }

    reader._readRequests = [];
  } else {
    assert(IsReadableStreamBYOBReader(reader), 'reader must be ReadableStreamBYOBReader');

    for (const req of reader._readIntoRequests) {
      req.reject(e);
    }

    reader._readIntoRequests = [];
  }

  reader._closedPromise_reject(e);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

function GetNumReadRequests(stream) {
  return stream._reader._readRequests.length;
}

function GetNumReadIntoRequests(stream) {
  return stream._reader._readIntoRequests.length;
}

function IsReadableStreamLocked(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamLocked should only be used on known readable streams');

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

function ReadableStreamHasBYOBReader(stream) {
  const reader = stream._reader;

  return reader !== undefined && IsReadableStreamBYOBReader(reader);
}

function ReadableStreamHasReader(stream) {
  const reader = stream._reader;

  return reader != undefined && IsReadableStreamReader(reader);
}

function RespondToReadIntoRequest(stream, buffer, length) {
  const reader = stream._reader;

  assert(reader._readIntoRequests.length > 0,
         'readIntoRequest must not be empty when calling RespondToReadIntoRequest');
  assert(stream._state !== 'errored', 'state must not be errored');

  const req = reader._readIntoRequests.shift();
  const ctor = req.ctor;
  const byteOffset = req.byteOffset;

  if (stream._state === 'closed') {
    assert(length === undefined);
    const view = new ctor(buffer, byteOffset, 0);
    req.resolve(CreateIterResultObject(view, true));

    return;
  }

  assert(length <= req.byteLength);
  assert(length % req.elementSize === 0);

  const view = new ctor(buffer, byteOffset, length / req.elementSize);
  req.resolve(CreateIterResultObject(view, false));
}

function RespondToReadRequest(stream, chunk) {
  const reader = stream._reader;

  assert(reader._readRequests.length > 0);

  const readRequest = reader._readRequests.shift();
  readRequest._resolve(CreateIterResultObject(chunk, false));
}

// Abstract operations for the readers.

// A client of ReadableStreamReader may use this function directly to bypass state check.
function CancelReadableStream(stream, reason) {
  assert(stream !== undefined);

  stream._disturbed = true;

  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  CloseReadableStream(stream);

  const sourceCancelPromise = stream._readableStreamController._cancel(reason);
  return sourceCancelPromise.then(() => undefined);
}

// A client of ReadableStreamReader may use this function directly to bypass state check.
function ReadFromReadableStreamReader(reader) {
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

  return stream._readableStreamController._pull();
}

// A client of ReadableStreamReader may use this function directly to bypass state check.
function ReleaseReadableStreamReader(reader) {
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

function InitializeReadableStreamReaderGeneric(reader, stream) {
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

// Abstract operations for the ReadableStreamController.

// A client of ReadableStreamController may use this function directly to bypass state check.
function CloseReadableStreamController(controller) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  controller._closeRequested = true;

  if (controller._queue.length === 0) {
    return CloseReadableStream(stream);
  }
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function GetReadableStreamControllerDesiredSize(controller) {
  const queueSize = GetTotalQueueSize(controller._queue);
  return controller._strategyHWM - queueSize;
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function EnqueueInReadableStreamController(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  if (IsReadableStreamLocked(stream) === true && GetNumReadRequests(stream) > 0) {
    RespondToReadRequest(stream, chunk);
  } else {
    let chunkSize = 1;

    if (controller._strategySize !== undefined) {
      try {
        chunkSize = controller._strategySize(chunk);
      } catch (chunkSizeE) {
        if (stream._state === 'readable') {
          ErrorReadableStreamController(controller, chunkSizeE);
        }
        throw chunkSizeE;
      }
    }

    try {
      EnqueueValueWithSize(controller._queue, chunk, chunkSize);
    } catch (enqueueE) {
      if (stream._state === 'readable') {
        ErrorReadableStreamController(controller, enqueueE);
      }
      throw enqueueE;
    }
  }

  ReadableStreamControllerCallPullIfNeeded(controller);

  return undefined;
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function ErrorReadableStreamController(controller, e) {
  const stream = controller._controlledReadableStream;

  assert(stream._state === 'readable');

  controller._queue = [];

  ErrorReadableStream(stream, e);
}

function ReadableStreamControllerCallPullIfNeeded(controller) {
  const shouldPull = ShouldPullReadableStreamController(controller);
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
        return ReadableStreamControllerCallPullIfNeeded(controller);
      }
    },
    e => {
      if (stream._state === 'readable') {
        return ErrorReadableStreamController(controller, e);
      }
    }
  )
  .catch(rethrowAssertionErrorRejection);

  return undefined;
}

function ShouldPullReadableStreamController(controller) {
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

  if (IsReadableStreamLocked(stream) === true && GetNumReadRequests(stream) > 0) {
    return true;
  }

  const desiredSize = GetReadableStreamControllerDesiredSize(controller);
  if (desiredSize > 0) {
    return true;
  }

  return false;
}

// Abstract operations for the ReadableByteStreamController.

// A client of ReadableByteStreamController may use this function directly to bypass state check.
function GetReadableByteStreamControllerDesiredSize(controller) {
  return controller._strategyHWM - controller._totalQueuedBytes;
}

// A client of ReadableByteStreamController may use this function directly to bypass state check.
function CloseReadableByteStreamController(controller) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  if (controller._totalQueuedBytes > 0) {
    controller._closeRequested = true;

    return;
  }

  if (ReadableStreamHasBYOBReader(stream) &&
      controller._pendingPullIntos.length > 0 &&
      controller._pendingPullIntos[0].bytesFilled > 0) {
    const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
    ErrorReadableByteStreamController(controller, e);

    throw e;
  }

  CloseReadableStream(stream);
}

// A client of ReadableByteStreamController may use this function directly to bypass state check.
function EnqueueInReadableByteStreamController(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state === 'readable');

  const buffer = chunk.buffer;
  const byteOffset = chunk.byteOffset;
  const byteLength = chunk.byteLength;

  if (ReadableStreamHasReader(stream)) {
    if (GetNumReadRequests(stream) === 0) {
      EnqueueChunkToQueueOfController(controller, TransferArrayBuffer(buffer), byteOffset, byteLength);
    } else {
      assert(controller._queue.length === 0);

      const transferredView = new Uint8Array(TransferArrayBuffer(buffer), byteOffset, byteLength);
      RespondToReadRequest(stream, transferredView);

      if (GetNumReadRequests(stream) > 0) {
        return;
      }
    }
  } else if (ReadableStreamHasBYOBReader(stream)) {
    // TODO: Ideally this detaching should happen only if the buffer is not consumed fully.
    EnqueueChunkToQueueOfController(controller, TransferArrayBuffer(buffer), byteOffset, byteLength);
    RespondToReadIntoRequestsFromQueue(controller);
    return;
  } else {
    assert(!IsReadableStreamLocked(stream), 'stream must not be locked');
    EnqueueChunkToQueueOfController(controller, TransferArrayBuffer(buffer), byteOffset, byteLength);
  }
}

// A client of ReadableByteStreamController may use this function directly to bypass state check.
function ErrorReadableByteStreamController(controller, e) {
  const stream = controller._controlledReadableStream;

  assert(stream._state === 'readable');

  ReadableByteStreamControllerClearPendingPullIntos(controller);

  controller._queue = [];

  ErrorReadableStream(stream, e);
}

// A client of ReadableByteStreamController may use this function directly to bypass state check.
function RespondToReadableByteStreamController(controller, bytesWritten, buffer) {
  bytesWritten = Number(bytesWritten);
  if (!isFiniteNonNegativeNumber(bytesWritten)) {
    throw new RangeError('bytesWritten must be a finite')
  }

  const stream = controller._controlledReadableStream;

  assert(controller._pendingPullIntos.length > 0);

  if (stream._state === 'closed') {
    if (bytesWritten !== 0) {
      throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
    }

    RespondToBYOBReaderInClosedState(controller, buffer);
  } else {
    assert(stream._state === 'readable');

    RespondToBYOBReaderInReadableState(controller, bytesWritten, buffer);
  }
}

function EnqueueChunkToQueueOfController(controller, buffer, byteOffset, byteLength) {
  controller._queue.push({buffer, byteOffset, byteLength});
  controller._totalQueuedBytes += byteLength;
}

function FillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor) {
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
    new Uint8Array(pullIntoDescriptor.buffer).set(
        new Uint8Array(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy), destStart);

    if (headOfQueue.byteLength === bytesToCopy) {
      queue.shift();
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }
    controller._totalQueuedBytes -= bytesToCopy;

    ReadableByteStreamControllerFillPullIntos(controller, bytesToCopy, pullIntoDescriptor);

    totalBytesToCopyRemaining -= bytesToCopy
  }

  if (!ready) {
    assert(controller._totalQueuedBytes === 0, 'queue must be empty');
    assert(pullIntoDescriptor.bytesFilled > 0);
    assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }

  return ready;
}

function ReadableByteStreamControllerCallPullOnceAndThenRepeatIfNeeded(controller) {
  const shouldPull = ShouldPullReadableByteStreamController(controller);
  if (shouldPull === false) {
    return;
  }

  if (controller._pulling) {
    controller._pullAgain = true;
    return;
  }

  ReadableByteStreamControllerCallPull(controller);
  ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);
}

function PullFromReadableByteStreamControllerInto(controller, buffer, byteOffset, byteLength, ctor, elementSize) {
  const stream = controller._controlledReadableStream;

  const pullIntoDescriptor = {
    buffer,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    elementSize
  };

  if (controller._pendingPullIntos.length > 0) {
    pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
    controller._pendingPullIntos.push(pullIntoDescriptor);

    return AddReadIntoRequestToReadableStream(stream, byteOffset, byteLength, ctor, elementSize);
  }

  if (stream._state === 'closed') {
    return Promise.resolve(CreateIterResultObject(new ctor(buffer, byteOffset, 0), true));
  }

  if (controller._totalQueuedBytes > 0) {
    const ready = FillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor);

    if (ready) {
      assert(pullIntoDescriptor.bytesFilled <= byteLength);
      assert(pullIntoDescriptor.bytesFilled % elementSize === 0);

      const view = new ctor(buffer, byteOffset, pullIntoDescriptor.bytesFilled / elementSize);
      const promise = Promise.resolve(CreateIterResultObject(view, false));

      if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
        CloseReadableStream(stream);
      } else {
        ReadableByteStreamControllerCallPullOnceAndThenRepeatIfNeeded(controller);
      }

      return promise;
    }

    if (controller._closeRequested) {
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ErrorReadableByteStreamController(controller, e)

      return Promise.reject(e);
    }
  }

  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  controller._pendingPullIntos.push(pullIntoDescriptor);

  const promise = AddReadIntoRequestToReadableStream(stream, byteOffset, byteLength, ctor, elementSize);

  if (controller._started === false) {
    return promise;
  }

  if (controller._pulling) {
    controller._pullAgain = true;
    return promise;
  }

  ReadableByteStreamControllerCallPull(controller);
  ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);

  return promise;
}

function ReadableByteStreamControllerCallPull(controller) {
  controller._pullAgain = false;
  controller._pulling = true;

  try {
    InvokeOrNoop(controller._underlyingByteSource, 'pull', []);
  } catch (e) {
    if (controller._controlledReadableStream._state === 'readable') {
      ErrorReadableByteStreamController(controller, e);
    }
  }

  controller._pulling = false;
}

function ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller) {
  if (controller._started === false) {
    return;
  }

  controller._pullAgain = true;

  if (controller._pulling) {
    return;
  }

  process.nextTick(ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded.bind(undefined, controller));
}

function ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller) {
  assert(controller._started === true);

  const stream = controller._controlledReadableStream;

  while (true) {
    if (!controller._pullAgain) {
      return;
    }

    if (controller._closeRequested) {
      return;
    }
    if (stream._state !== 'readable') {
      return;
    }

    if (ReadableStreamHasReader(stream) && GetNumReadRequests(stream) > 0) {
      ReadableByteStreamControllerCallPull(controller);
    } else if (ReadableStreamHasBYOBReader(stream) && GetNumReadIntoRequests(stream) > 0) {
      ReadableByteStreamControllerCallPull(controller);
    } else {
      const desiredSize = GetReadableByteStreamControllerDesiredSize(controller);
      if (desiredSize > 0) {
        ReadableByteStreamControllerCallPull(controller);
      } else {
        controller._pullAgain = false;
        return;
      }
    }
  }
}

function ReadableByteStreamControllerFillPullIntos(controller, size, pullIntoDescriptor) {
  assert(controller._pendingPullIntos.length === 0 || controller._pendingPullIntos[0] === pullIntoDescriptor);

  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }

  pullIntoDescriptor.bytesFilled += size;
}

function ReadableByteStreamControllerClearPendingPullIntos(controller) {
  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }
  controller._pendingPullIntos = [];
}

function ReadableByteStreamControllerShiftPendingPullInto(controller) {
  const descriptor = controller._pendingPullIntos.shift();
  if (controller._byobRequest !== undefined) {
    controller._byobRequest._invalidate();
    controller._byobRequest = undefined;
  }
  return descriptor;
}

function RespondToBYOBReaderInClosedState(controller, buffer) {
  const firstDescriptor = controller._pendingPullIntos[0];

  if (buffer !== undefined) {
    firstDescriptor.buffer = buffer;
  }

  firstDescriptor.buffer = TransferArrayBuffer(firstDescriptor.buffer);

  assert(firstDescriptor.bytesFilled === 0, 'bytesFilled must be 0');

  const stream = controller._controlledReadableStream;

  while (GetNumReadIntoRequests(stream) > 0) {
    const descriptor = ReadableByteStreamControllerShiftPendingPullInto(controller);

    RespondToReadIntoRequest(stream, descriptor.buffer);
  }
}

function RespondToBYOBReaderInReadableState(controller, bytesWritten, buffer) {
  const pullIntoDescriptor = controller._pendingPullIntos[0];

  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
    throw new RangeError('bytesWritten out of range');
  }

  if (buffer !== undefined) {
    pullIntoDescriptor.buffer = buffer;
  }

  ReadableByteStreamControllerFillPullIntos(controller, bytesWritten, pullIntoDescriptor);

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    // TODO: Figure out whether we should detach the buffer or not here.
    ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller);
    return;
  }

  ReadableByteStreamControllerShiftPendingPullInto(controller);

  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, end);
    EnqueueChunkToQueueOfController(controller, remainder, 0, remainder.byteLength);
  }

  RespondToReadIntoRequest(
      controller._controlledReadableStream,
      TransferArrayBuffer(pullIntoDescriptor.buffer),
      pullIntoDescriptor.bytesFilled - remainderSize);

  RespondToReadIntoRequestsFromQueue(controller);
}

function RespondToReadIntoRequestsFromQueue(controller) {
  assert(!controller._closeRequested);

  while (controller._pendingPullIntos.length > 0) {
    if (controller._totalQueuedBytes === 0) {
      ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller);
      return;
    }

    const pullIntoDescriptor = controller._pendingPullIntos[0];

    const ready = FillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor);

    if (ready) {
      ReadableByteStreamControllerShiftPendingPullInto(controller);

      RespondToReadIntoRequest(
          controller._controlledReadableStream, pullIntoDescriptor.buffer, pullIntoDescriptor.bytesFilled);
    }
  }
}

function ShouldPullReadableByteStreamController(controller) {
  const stream = controller._controlledReadableStream;

  if (controller._started === false) {
    return false;
  }

  if (ReadableStreamHasReader(stream) && GetNumReadRequests(stream) > 0) {
    return true;
  }

  const desiredSize = GetReadableByteStreamControllerDesiredSize(controller);
  if (desiredSize > 0) {
    return true;
  }

  return false;
}
