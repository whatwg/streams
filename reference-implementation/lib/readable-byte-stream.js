const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } from './helpers';

export default class ReadableByteStream {
  constructor(underlyingByteSource = {}) {
    // Exposed to controllers.
    this._state = 'readable';

    this._reader = undefined;
    this._storedError = undefined;

    // Initialize to undefined first because the constructor of the ReadableByteStreamController checks this
    // variable to validate the caller.
    this._controller = undefined;
    this._controller = new ReadableByteStreamController(this, underlyingByteSource);
  }

  cancel(reason) {
    if (IsReadableByteStream(this) === false) {
      return Promise.reject(
          new TypeError('ReadableByteStream.prototype.cancel can only be used on a ReadableByteStream'));
    }

    if (IsReadableByteStreamLocked(this) === true) {
      return Promise.reject(new TypeError('Cannot cancel a stream that already has a reader'));
    }

    return CancelReadableByteStream(this, reason);
  }

  getByobReader() {
    if (IsReadableByteStream(this) === false) {
      throw new TypeError('ReadableByteStream.prototype.getByobReader can only be used on a ReadableByteStream');
    }

    return new ReadableByteStreamByobReader(this);
  }

  getReader() {
    if (IsReadableByteStream(this) === false) {
      throw new TypeError('ReadableByteStream.prototype.getReader can only be used on a ReadableByteStream');
    }

    return new ReadableByteStreamReader(this);
  }
}

class ReadableByteStreamController {
  constructor(controlledReadableByteStream, underlyingByteSource) {
    if (IsReadableByteStream(controlledReadableByteStream) === false) {
      throw new TypeError('ReadableByteStreamController can only be constructed with a ReadableByteStream instance');
    }

    if (controlledReadableByteStream._controller !== undefined) {
      throw new TypeError(
          'ReadableByteStreamController instances can only be created by the ReadableByteStream constructor');
    }

    this._controlledReadableByteStream = controlledReadableByteStream;

    this._underlyingByteSource = underlyingByteSource;

    this._pullAgain = false;
    this._pulling = false;

    this._pendingPullIntos = [];

    this._queue = [];
    this._totalQueuedBytes = 0;

    this._closeRequested = false;

    InvokeOrNoop(underlyingByteSource, 'start', [this]);
  }

  close() {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.close can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (this._closeRequested) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }
    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be closed');
    }

    if (this._totalQueuedBytes > 0) {
      this._closeRequested = true;

      return;
    }

    if (ReadableByteStreamHasByobReader(stream) &&
        this._pendingPullIntos.length > 0 &&
        this._pendingPullIntos[0].bytesFilled > 0) {
      DestroyReadableByteStreamController(this);
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ErrorReadableByteStream(stream, e);

      throw e;
    }

    CloseReadableByteStream(stream);
  }

  enqueue(chunk) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.enqueue can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (this._closeRequested) {
      throw new TypeError('stream is closed or draining');
    }
    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be enqueued to');
    }

    const buffer = chunk.buffer;
    const byteOffset = chunk.byteOffset;
    const byteLength = chunk.byteLength;

    if (ReadableByteStreamHasReader(stream)) {
      if (GetNumReadRequests(stream) === 0) {
        EnqueueInReadableByteStreamController(this, TransferArrayBuffer(buffer), byteOffset, byteLength);
      } else {
        assert(this._queue.length === 0);

        const transferredView = new Uint8Array(TransferArrayBuffer(buffer), byteOffset, byteLength);
        RespondToReadRequest(stream, transferredView);

        if (GetNumReadRequests(stream) > 0) {
          ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(this);
        }
      }
    } else if (ReadableByteStreamHasByobReader(stream)) {
      // TODO: Ideally this detaching should happen only if the buffer is not consumed fully.
      EnqueueInReadableByteStreamController(this, TransferArrayBuffer(buffer), byteOffset, byteLength);
      RespondToReadIntoRequestsFromQueue(this);
    } else {
      assert(!IsReadableByteStreamLocked(stream), 'stream must not be locked');
      EnqueueInReadableByteStreamController(this, TransferArrayBuffer(buffer), byteOffset, byteLength);
    }
  }

  error(e) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.error can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    DestroyReadableByteStreamController(this);
    ErrorReadableByteStream(stream, e);
  }

  respond(bytesWritten, buffer) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.respond can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (this._pendingPullIntos.length === 0) {
      throw new TypeError('No pending BYOB read');
    }

    assert(ReadableByteStreamHasByobReader(stream), 'reader must be ReadableByteStreamByobReader');

    if (stream._state === 'closed') {
      if (bytesWritten !== 0) {
        throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
      }

      RespondToByobReaderInClosedState(this, buffer);
    } else {
      assert(stream._state === 'readable');

      RespondToByobReaderInReadableState(this, bytesWritten, buffer);
    }
  }
}

class ReadableByteStreamReader {
  constructor(stream) {
    if (!IsReadableByteStream(stream)) {
      throw new TypeError('ReadableByteStreamReader can only be constructed with a ReadableByteStream instance');
    }
    if (IsReadableByteStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    InitializeReadableByteStreamReaderGeneric(this, stream);

    this._readRequests = [];
  }

  get closed() {
    if (!IsReadableByteStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.closed can only be used on a ReadableByteStreamReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (!IsReadableByteStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.cancel can only be used on a ReadableByteStreamReader'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableByteStream !== undefined, 'This reader must be attached to a stream');

    return CancelReadableByteStream(this._ownerReadableByteStream, reason);
  }

  read() {
    if (!IsReadableByteStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.read can only be used on a ReadableByteStreamReader'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(CreateIterResultObject(undefined, true));
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableByteStream !== undefined, 'This reader must be attached to a stream');
    assert(this._ownerReadableByteStream._state === 'readable', 'The owner stream must be in readable state');

    // Controllers must implement this.
    return PullFromReadableByteStream(this._ownerReadableByteStream._controller);
  }

  releaseLock() {
    if (!IsReadableByteStreamReader(this)) {
      throw new TypeError(
          'ReadableByteStreamReader.prototype.releaseLock can only be used on a ReadableByteStreamReader');
    }

    if (this._ownerReadableByteStream === undefined) {
      return;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    assert(this._ownerReadableByteStream._state === 'readable');

    ReleaseReadableByteStreamReaderGeneric(this);
    CloseReadableByteStreamReaderGeneric(this);
  }
}

class ReadableByteStreamByobReader {
  constructor(stream) {
    if (!IsReadableByteStream(stream)) {
      throw new TypeError('ReadableByteStreamByobReader can only be constructed with a ReadableByteStream instance');
    }
    if (IsReadableByteStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    InitializeReadableByteStreamReaderGeneric(this, stream);

    this._readIntoRequests = [];
  }

  get closed() {
    if (!IsReadableByteStreamByobReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.closed can only be used on a ReadableByteStreamByobReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (!IsReadableByteStreamByobReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.cancel can only be used on a ReadableByteStreamByobReader'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableByteStream !== undefined, 'This stream must be attached to a stream');

    return CancelReadableByteStream(this._ownerReadableByteStream, reason);
  }

  read(view) {
    if (!IsReadableByteStreamByobReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.read can only be used on a ReadableByteStreamByobReader'));
    }

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

    if (this._state === 'errored') {
      assert(this._ownerReadableByteStream === undefined, 'This reader must be detached');

      return Promise.reject(this._storedError);
    }

    if (this._state === 'closed' && this._ownerReadableByteStream === undefined) {
      return Promise.resolve(CreateIterResultObject(new ctor(view.buffer, view.byteOffset, 0), true));
    }

    // Controllers must implement this.
    return PullFromReadableByteStreamInto(
        this._ownerReadableByteStream._controller, view.buffer, view.byteOffset, view.byteLength, ctor, elementSize);
  }

  releaseLock() {
    if (!IsReadableByteStreamByobReader(this)) {
      throw new TypeError(
          'ReadableByteStreamByobReader.prototype.releaseLock can only be used on a ReadableByteStreamByobReader');
    }

    if (this._ownerReadableByteStream === undefined) {
      return;
    }

    if (this._readIntoRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    assert(this._ownerReadableByteStream._state === 'readable');

    ReleaseReadableByteStreamReaderGeneric(this);
    CloseReadableByteStreamReaderGeneric(this);
  }
}

// Exposed to controllers.
function AddReadIntoRequestToReadableByteStream(stream, byteOffset, byteLength, ctor, elementSize) {
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

// Exposed to controllers.
function AddReadRequestToReadableByteStream(stream) {
  return new Promise((_resolve, _reject) => {
    stream._reader._readRequests.push({_resolve, _reject});
  });
}

function ReadableByteStreamControllerCallPull(controller) {
  const stream = controller._controlledReadableByteStream;

  controller._pullAgain = false;
  controller._pulling = true;

  try {
    InvokeOrNoop(controller._underlyingByteSource, 'pull', []);
  } catch (e) {
    DestroyReadableByteStreamController(controller);
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  controller._pulling = false;
}

function ReadableByteStreamControllerCallPullInto(controller) {
  const stream = controller._controlledReadableByteStream;

  assert(controller._pendingPullIntos.length > 0);
  const pullIntoDescriptor = controller._pendingPullIntos[0];

  controller._pullAgain = false;
  controller._pulling = true;

  try {
    InvokeOrNoop(controller._underlyingByteSource,
                 'pullInto',
                 [new Uint8Array(pullIntoDescriptor.buffer,
                                 pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled,
                                 pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled)]);
  } catch (e) {
    DestroyReadableByteStreamController(controller);
    const stream = controller._controlledReadableByteStream;
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  controller._pulling = false;
}

function ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller) {
  controller._pullAgain = true;

  if (controller._pulling) {
    return;
  }

  process.nextTick(ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded.bind(undefined, controller));
}

function ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller) {
  const stream = controller._controlledReadableByteStream;

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

    if (ReadableByteStreamHasReader(stream)) {
      if (GetNumReadRequests(stream) === 0) {
        return;
      }

      ReadableByteStreamControllerCallPull(controller);
    } else if (ReadableByteStreamHasByobReader(stream)) {
      if (GetNumReadIntoRequests(stream) === 0) {
        return;
      }

      ReadableByteStreamControllerCallPullInto(controller);
    }
  }
}

function CancelReadableByteStream(stream, reason) {
  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  CloseReadableByteStream(stream);

  const sourceCancelPromise = CancelReadableByteStreamController(stream._controller, reason);
  return sourceCancelPromise.then(() => undefined);
}

function CancelReadableByteStreamController(controller, reason) {
  if (controller._pendingPullIntos.length > 0) {
    controller._pendingPullIntos[0].bytesFilled = 0;
  }

  controller._queue = [];
  controller._totalQueuedBytes = 0;

  return PromiseInvokeOrNoop(controller._underlyingByteSource, 'cancel', [reason]);
}

// Exposed to controllers.
function CloseReadableByteStream(stream) {
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'closed';

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableByteStreamReader(reader)) {
    for (const req of reader._readRequests) {
      req._resolve(CreateIterResultObject(undefined, true));
    }

    reader._readRequests = [];
    ReleaseReadableByteStreamReaderGeneric(reader);
  } else {
    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    if (reader._readIntoRequests.length === 0) {
      ReleaseReadableByteStreamReaderGeneric(reader);
    }
  }

  CloseReadableByteStreamReaderGeneric(reader);
}

function CloseReadableByteStreamReaderGeneric(reader) {
  reader._state = 'closed';

  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
}

function DestroyReadableByteStreamController(controller) {
  controller._pendingPullIntos = []
  controller._queue = [];
}

function TransferArrayBuffer(buffer) {
  // No-op. Just for marking places where detaching an ArrayBuffer is required.

  return buffer;
}

function ReleaseReadableByteStreamReaderGeneric(reader) {
  assert(reader._ownerReadableByteStream._reader !== undefined);
  assert(reader._ownerReadableByteStream !== undefined);

  reader._ownerReadableByteStream._reader = undefined;
  reader._ownerReadableByteStream = undefined;
}

function EnqueueInReadableByteStreamController(controller, buffer, byteOffset, byteLength) {
  controller._queue.push({buffer, byteOffset, byteLength});
  controller._totalQueuedBytes += byteLength;
}

// Exposed to controllers.
function ErrorReadableByteStream(stream, e) {
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'errored';
  stream._storedError = e;

  const reader = stream._reader;

  if (reader === undefined) {
    return undefined;
  }

  if (IsReadableByteStreamReader(reader)) {
    for (const req of reader._readRequests) {
      req._reject(e);
    }

    reader._readRequests = [];
  } else {
    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    for (const req of reader._readIntoRequests) {
      req.reject(e);
    }

    reader._readIntoRequests = [];
  }

  ReleaseReadableByteStreamReaderGeneric(reader);

  reader._state = 'errored';
  reader._storedError = e;

  reader._closedPromise_reject(e);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;
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

    pullIntoDescriptor.bytesFilled += bytesToCopy;

    totalBytesToCopyRemaining -= bytesToCopy
  }

  if (!ready) {
    assert(controller._totalQueuedBytes === 0, 'queue must be empty');
    assert(pullIntoDescriptor.bytesFilled > 0);
    assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
  }

  return ready;
}

// Exposed to controllers.
function GetNumReadRequests(stream) {
  return stream._reader._readRequests.length;
}

// Exposed to controllers.
function GetNumReadIntoRequests(stream) {
  return stream._reader._readIntoRequests.length;
}

function InitializeReadableByteStreamReaderGeneric(reader, stream) {
  reader._state = stream._state;

  if (stream._state === 'readable') {
    stream._reader = reader;

    reader._ownerReadableByteStream = stream;
    reader._storedError = undefined;
    reader._closedPromise = new Promise((resolve, reject) => {
      reader._closedPromise_resolve = resolve;
      reader._closedPromise_reject = reject;
    });
  } else {
    reader._ownerReadableByteStream = undefined;

    if (stream._state === 'closed') {
      reader._storedError = undefined;

      reader._closedPromise = Promise.resolve(undefined);
      reader._closedPromise_resolve = undefined;
      reader._closedPromise_reject = undefined;
    } else {
      assert(stream._state === 'errored', 'state must be errored');

      reader._storedError = stream._storedError;

      reader._closedPromise = Promise.reject(stream._storedError);
      reader._closedPromise_resolve = undefined;
      reader._closedPromise_reject = undefined;
    }
  }
}

function IsReadableByteStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controller')) {
    return false;
  }

  return true;
}

function IsReadableByteStreamByobReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readIntoRequests')) {
    return false;
  }

  return true;
}

function IsReadableByteStreamController(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_controlledReadableByteStream')) {
    return false;
  }

  return true;
}

// Exposed to controllers.
function IsReadableByteStreamLocked(stream) {
  assert(IsReadableByteStream(stream),
         'IsReadableByteStreamLocked should only be used on known readable byte streams');

  if (stream._reader === undefined) {
    return false;
  }

  return true;
}

function IsReadableByteStreamReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readRequests')) {
    return false;
  }

  return true;
}

function PullFromReadableByteStream(controller) {
  const stream = controller._controlledReadableByteStream;

  if (GetNumReadRequests(stream) >= 1) {
    const pendingPromise = AddReadRequestToReadableByteStream(stream);
    return pendingPromise;
  }

  if (controller._totalQueuedBytes > 0) {
    const entry = controller._queue.shift();
    controller._totalQueuedBytes -= entry.byteLength;

    const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);
    const promise = Promise.resolve(CreateIterResultObject(view, false));

    if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
      CloseReadableByteStream(stream);
    }

    return promise;
  }

  const promise = AddReadRequestToReadableByteStream(stream);

  if (controller._pulling) {
    controller._pullAgain = true;
    return promise;
  }

  ReadableByteStreamControllerCallPull(controller);
  ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);

  return promise;
}

function PullFromReadableByteStreamInto(controller, buffer, byteOffset, byteLength, ctor, elementSize) {
  const stream = controller._controlledReadableByteStream;

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

    return AddReadIntoRequestToReadableByteStream(stream, byteOffset, byteLength, ctor, elementSize);
  }

  if (controller._totalQueuedBytes > 0) {
    const ready = FillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor);

    if (ready) {
      assert(pullIntoDescriptor.bytesFilled <= byteLength);
      assert(pullIntoDescriptor.bytesFilled % elementSize === 0);

      const view = new ctor(buffer, byteOffset, pullIntoDescriptor.bytesFilled / elementSize);
      const promise = Promise.resolve(CreateIterResultObject(view, false));

      if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
        CloseReadableByteStream(stream);
      }

      return promise;
    }

    if (controller._closeRequested) {
      DestroyReadableByteStreamController(controller);
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ErrorReadableByteStream(stream, e);

      return Promise.reject(e);
    }
  }

  pullIntoDescriptor.buffer = TransferArrayBuffer(pullIntoDescriptor.buffer);
  controller._pendingPullIntos.push(pullIntoDescriptor);

  const promise = AddReadIntoRequestToReadableByteStream(stream, byteOffset, byteLength, ctor, elementSize);

  if (controller._pulling) {
    controller._pullAgain = true;
    return promise;
  }

  ReadableByteStreamControllerCallPullInto(controller);
  ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);

  return promise;
}

// Exposed to controllers.
function ReadableByteStreamHasByobReader(stream) {
  const reader = stream._reader;

  return reader !== undefined && IsReadableByteStreamByobReader(reader);
}

// Exposed to controllers.
function ReadableByteStreamHasReader(stream) {
  const reader = stream._reader;

  return reader != undefined && IsReadableByteStreamReader(reader);
}

// Exposed to controllers.
function ReleaseReadableByteStreamReaderGenericForController(stream) {
  ReleaseReadableByteStreamReaderGeneric(stream._reader);
}

function RespondToByobReaderInClosedState(controller, buffer) {
  const firstDescriptor = controller._pendingPullIntos[0];

  if (buffer !== undefined) {
    firstDescriptor.buffer = buffer;
  }

  firstDescriptor.buffer = TransferArrayBuffer(firstDescriptor.buffer);

  assert(firstDescriptor.bytesFilled === 0, 'bytesFilled must be 0');

  const stream = controller._controlledReadableByteStream;

  while (GetNumReadIntoRequests(stream) > 0) {
    const descriptor = controller._pendingPullIntos.shift();
    RespondToReadIntoRequest(stream, descriptor.buffer);
  }

  ReleaseReadableByteStreamReaderGenericForController(controller._controlledReadableByteStream);
}

function RespondToByobReaderInReadableState(controller, bytesWritten, buffer) {
  const pullIntoDescriptor = controller._pendingPullIntos[0];

  if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
    throw new RangeError('bytesWritten out of range');
  }

  if (buffer !== undefined) {
    pullIntoDescriptor.buffer = buffer;
  }

  pullIntoDescriptor.bytesFilled += bytesWritten;

  if (pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize) {
    // TODO: Figure out whether we should detach the buffer or not here.
    ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller);
    return;
  }

  controller._pendingPullIntos.shift();

  const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
  if (remainderSize > 0) {
    const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
    const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, end);
    EnqueueInReadableByteStreamController(controller, remainder, 0, remainder.byteLength);
  }

  RespondToReadIntoRequest(
      controller._controlledReadableByteStream,
      TransferArrayBuffer(pullIntoDescriptor.buffer),
      pullIntoDescriptor.bytesFilled - remainderSize);

  RespondToReadIntoRequestsFromQueue(controller);
}

// Exposed to controllers.
function RespondToReadIntoRequest(stream, buffer, length) {
  const reader = stream._reader;

  assert(reader._readIntoRequests.length > 0,
         'readIntoRequest must not be empty when calling RespondToReadIntoRequest');
  assert(reader._state !== 'errored', 'state must not be errored');

  const req = reader._readIntoRequests.shift();
  const ctor = req.ctor;
  const byteOffset = req.byteOffset;

  if (reader._state === 'closed') {
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

// Exposed to controllers.
function RespondToReadRequest(stream, view) {
  const req = stream._reader._readRequests.shift();
  req._resolve(CreateIterResultObject(view, false));
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
      controller._pendingPullIntos.shift();

      RespondToReadIntoRequest(controller._controlledReadableByteStream, pullIntoDescriptor.buffer, pullIntoDescriptor.bytesFilled);
    }
  }
}
