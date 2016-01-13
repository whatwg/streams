const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, ValidateAndNormalizeQueuingStrategy } from './helpers';
import { createArrayFromList, createDataProperty, typeIsObject } from './helpers';
import { rethrowAssertionErrorRejection } from './utils';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';

export default class ReadableStream {
  constructor(underlyingSource = {}, { size, highWaterMark = 1 } = {}) {
    // Exposed to controllers.
    this._state = 'readable';

    this._reader = undefined;
    this._storedError = undefined;

    this._disturbed = false;

    this._controller = undefined;
    this._controller = new ReadableStreamController(this, underlyingSource, size, highWaterMark);
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

class ReadableStreamController {
  constructor(stream, underlyingSource, size, highWaterMark) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamController can only be constructed with a ReadableStream instance');
    }

    if (stream._controller !== undefined) {
      throw new TypeError('ReadableStreamController instances can only be created by the ReadableStream constructor');
    }

    this._cancel = CancelReadableStreamController;

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

    if (this._controlledReadableStream._state === 'errored') {
      throw new TypeError('The stream is in an errored state and cannot be closed');
    }

    return CloseReadableStreamController(this);
  }

  enqueue(chunk) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.enqueue can only be used on a ReadableStreamController');
    }

    const stream = this._controlledReadableStream;
    if (stream._state === 'errored') {
      throw stream._storedError;
    }

    if (this._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
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
}

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

    if (this._ownerReadableStream._state === 'readable') {
      this._closedPromise_reject(
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
    } else {
      this._closedPromise = Promise.reject(
        new TypeError('Reader was released and can no longer be used to monitor the stream\'s closedness'));
    }

    this._ownerReadableStream._reader = undefined;
    this._ownerReadableStream = undefined;

    return undefined;
  }
}


function AcquireReadableStreamReader(stream) {
  return new ReadableStreamReader(stream);
}

// Exposed to controllers.
function AddReadRequestToReadableStream(stream) {
  const readRequest = {};
  const promise = new Promise((resolve, reject) => {
    readRequest._resolve = resolve;
    readRequest._reject = reject;
  });

  stream._reader._readRequests.push(readRequest);

  return promise;
}

export function CancelReadableStream(stream, reason) {
  stream._disturbed = true;

  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  CloseReadableStream(stream);

  const sourceCancelPromise = stream._controller._cancel(stream._controller, reason);
  return sourceCancelPromise.then(() => undefined);
}

function CancelReadableStreamController(controller, reason) {
  controller._queue = [];

  return PromiseInvokeOrNoop(controller._underlyingSource, 'cancel', [reason]);
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function CloseReadableStreamController(controller) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state !== 'errored');

  if (stream._state === 'closed') {
    // This will happen if the stream was closed without calling its controller's close() method, i.e. if it was closed
    // via cancellation.
    return undefined;
  }

  controller._closeRequested = true;

  if (controller._queue.length === 0) {
    return CloseReadableStream(stream);
  }
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function EnqueueInReadableStreamController(controller, chunk) {
  const stream = controller._controlledReadableStream;

  assert(controller._closeRequested === false);
  assert(stream._state !== 'errored');

  if (stream._state === 'closed') {
    // This will happen if the stream was closed without calling its controller's close() method, i.e. if it was closed
    // via cancellation.
    return undefined;
  }

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

// Exposed to controllers.
function ErrorReadableStream(stream, e) {
  assert(stream._state === 'readable');

  stream._storedError = e;
  stream._state = 'errored';

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  for (const { _reject } of reader._readRequests) {
    _reject(e);
  }
  reader._readRequests = [];

  reader._closedPromise_reject(e);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function ErrorReadableStreamController(controller, e) {
  controller._queue = [];

  ErrorReadableStream(controller._controlledReadableStream, e);
}

// Exposed to controllers.
function GetNumReadRequests(stream) {
  return stream._reader._readRequests.length;
}

// Exposed to controllers.
export function CloseReadableStream(stream) {
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

  CloseReadableStreamReaderGeneric(reader);

  return undefined;
}

export function CloseReadableStreamReaderGeneric(reader) {
  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

// A client of ReadableStreamController may use this function directly to bypass state check.
function GetReadableStreamControllerDesiredSize(controller) {
  const queueSize = GetTotalQueueSize(controller._queue);
  return controller._strategyHWM - queueSize;
}

export function InitializeReadableStreamReaderGeneric(reader, stream) {
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

export function IsReadableByteStreamReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readRequests')) {
    return false;
  }

  return true;
}

export function IsReadableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controller')) {
    return false;
  }

  return true;
}

export function IsReadableStreamDisturbed(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamDisturbed should only be used on known readable streams');

  return stream._disturbed;
}

// Exposed to controllers.
function IsReadableStreamLocked(stream) {
  assert(IsReadableStream(stream) === true, 'IsReadableStreamLocked should only be used on known readable streams');

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

function IsReadableStreamController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledReadableStream')) {
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

function PullFromReadableStreamController(controller) {
  const stream = controller._controlledReadableStream;

  if (controller._queue.length > 0) {
    const chunk = DequeueValue(controller._queue);

    if (controller._closeRequested === true && controller._queue.length === 0) {
      CloseReadableStream(stream);
    } else {
      ReadableStreamControllerCallPullIfNeeded(controller);
    }

    return Promise.resolve(CreateIterResultObject(chunk, false));
  }

  const pendingPromise = AddReadRequestToReadableStream(stream);
  ReadableStreamControllerCallPullIfNeeded(controller);
  return pendingPromise;
}

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

  // Controllers must implement this.
  return PullFromReadableStreamController(stream._controller);
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

// Exposed to controllers.
function RespondToReadRequest(stream, chunk) {
  const reader = stream._reader;

  assert(reader._readRequests.length > 0);

  const readRequest = reader._readRequests.shift();
  readRequest._resolve(CreateIterResultObject(chunk, false));
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

  pull._branch1 = branch1Stream._controller;
  pull._branch2 = branch2Stream._controller;

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
    const { _reader: reader, _branch1: branch1, _branch2: branch2, _teeState: teeState, _shouldClone: shouldClone } = f;

    return ReadFromReadableStreamReader(reader).then(result => {
      assert(typeIsObject(result));
      const value = result.value;
      const done = result.done;
      assert(typeof done === "boolean");

      if (done === true && teeState.closedOrErrored === false) {
        CloseReadableStreamController(branch1);
        CloseReadableStreamController(branch2);
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
