const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } from './helpers';

export default class ReadableByteStream {
  constructor(underlyingByteSource = {}) {
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

    if (IsReadableByteStreamLocked(this)) {
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

    this._considerReissueUnderlyingByteSourcePullOrPullInto = false;
    this._insideUnderlyingByteSource = false;

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

    const reader = stream._reader;

    if (reader === undefined || IsReadableByteStreamReader(reader)) {
      CloseReadableByteStream(stream);
      return;
    }

    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    if (this._pendingPullIntos.length > 0 && this._pendingPullIntos[0].bytesFilled > 0) {
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

    const reader = stream._reader;

    if (reader === undefined) {
      EnqueueInReadableByteStreamController(this, chunk);
    } else {
      if (IsReadableByteStreamReader(reader)) {
        if (reader._readRequests.length === 0) {
          EnqueueInReadableByteStreamController(this, chunk);
        } else {
          assert(this._queue.length === 0);

          const req = reader._readRequests.shift();
          // TODO: Detach chunk.
          req.resolve(CreateIterResultObject(chunk, false));

          if (this._closeRequested === true) {
            CloseReadableByteStream(stream);
            return;
          }

          if (reader._readRequests.length > 0) {
            ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(this);
          }
        }
      } else {
        assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

        EnqueueInReadableByteStreamController(this, chunk);
        RespondToReadIntoRequestsFromQueue(this, reader);
      }
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

    assert(IsReadableByteStreamLocked(stream), 'stream must be locked');

    const reader = stream._reader;

    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    const pullIntoDescriptor = this._pendingPullIntos[0];

    if (pullIntoDescriptor.bytesFilled + bytesWritten > pullIntoDescriptor.byteLength) {
      throw new RangeError('bytesWritten out of range');
    }

    if (buffer !== undefined) {
      pullIntoDescriptor.buffer = buffer;
    }

    if (stream._state === 'closed') {
      if (bytesWritten !== 0) {
        throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
      }

      assert(pullIntoDescriptor.bytesFilled === 0, 'bytesFilled must be 0');

      while (reader._readIntoRequests.length > 0) {
        const descriptor = this._pendingPullIntos.shift();
        RespondToReadIntoRequest(reader, descriptor.buffer);
      }

      DetachReadableByteStreamReader(reader);

      return;
    }

    pullIntoDescriptor.bytesFilled += bytesWritten;

    if (pullIntoDescriptor.bytesFilled >= pullIntoDescriptor.elementSize) {
      this._pendingPullIntos.shift();

      const remainderSize = pullIntoDescriptor.bytesFilled % pullIntoDescriptor.elementSize;
      if (remainderSize > 0) {
        const end = pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled;
        const remainder = pullIntoDescriptor.buffer.slice(end - remainderSize, end);
        EnqueueInReadableByteStreamController(this, new Uint8Array(remainder));
      }

      RespondToReadIntoRequest(reader, pullIntoDescriptor.buffer, pullIntoDescriptor.bytesFilled - remainderSize);

      RespondToReadIntoRequestsFromQueue(this, reader);

      return;
    }

    ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(this);
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

    InitializeReadableByteStreamReader(this, stream);

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

    const promise = new Promise((resolve, reject) => {
      this._readRequests.push({resolve, reject});
    });

    PullFromReadableByteStream(this._ownerReadableByteStream);

    return promise;
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

    CloseReadableByteStreamReader(this);
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

    InitializeReadableByteStreamReader(this, stream);

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

    const promise = new Promise((resolve, reject) => {
      const req = {
        resolve,
        reject,
        byteOffset: view.byteOffset,
        byteLength: view.byteLength,
        ctor,
        elementSize
      };
      this._readIntoRequests.push(req);
    });

    PullFromReadableByteStreamInto(
        this._ownerReadableByteStream, view.buffer, view.byteOffset, view.byteLength, elementSize);

    return promise;
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

    CloseReadableByteStreamReader(this);
  }
}

function ReadableByteStreamControllerCallPull(controller) {
  const source = controller._underlyingByteSource;

  const pullFunction = source['pull'];
  if (pullFunction === undefined) {
    return;
  }

  const stream = controller._controlledReadableByteStream;

  if (typeof pullFunction !== 'function') {
    DestroyReadableByteStreamController(controller);
    ErrorReadableByteStream(stream, new TypeError('pull property of an underlying byte source must be a function'));
    return;
  }

  controller._callPullOrPullIntoLaterIfNeeded = false;
  controller._insideUnderlyingByteSource = true;

  try {
    pullFunction.call(source);
  } catch (e) {
    DestroyReadableByteStreamController(controller);
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  controller._insideUnderlyingByteSource = false;
}

function ReadableByteStreamControllerCallPullInto(controller) {
  const source = controller._underlyingByteSource;

  const pullIntoFunction = source['pullInto'];
  if (pullIntoFunction === undefined) {
    return;
  }

  const stream = controller._controlledReadableByteStream;

  if (typeof pullIntoFunction !== 'function') {
    DestroyReadableByteStreamController(controller);
    ErrorReadableByteStream(stream, new TypeError('pullInto property of an underlying byte source must be a function'));
    return;
  }

  assert(controller._pendingPullIntos.length > 0);
  const pullIntoDescriptor = controller._pendingPullIntos[0];

  controller._callPullOrPullIntoLaterIfNeeded = false;
  controller._insideUnderlyingByteSource = true;

  try {
    pullIntoFunction.call(source,
                          new Uint8Array(pullIntoDescriptor.buffer,
                                         pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled,
                                         pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled));
  } catch (e) {
    DestroyReadableByteStreamController(controller);
    const stream = controller._controlledReadableByteStream;
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  controller._insideUnderlyingByteSource = false;
}

function ReadableByteStreamControllerCallPullOrPullIntoLaterIfNeeded(controller) {
  if (controller._insideUnderlyingByteSource) {
    controller._callPullOrPullIntoLaterIfNeeded = true;
    return;
  }

  Promise.resolve().then(ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded.bind(undefined, controller));
}

function ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller) {
  const stream = controller._controlledReadableByteStream;

  while (true) {
    if (!controller._callPullOrPullIntoLaterIfNeeded) {
      return;
    }

    if (controller._closeRequested) {
      return;
    }
    if (stream._state !== 'readable') {
      return;
    }

    const reader = stream._reader;

    if (reader === undefined) {
      return;
    }

    if (IsReadableByteStreamReader(reader)) {
      if (reader._readRequests.length === 0) {
        return;
      }

      ReadableByteStreamControllerCallPull(controller);
    } else {
      assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

      if (reader._readIntoRequests.length === 0) {
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

  const controller = stream._controller;

  controller._totalQueuedBytes = 0;
  controller._queue = [];

  const sourceCancelPromise = PromiseInvokeOrNoop(controller._underlyingByteSource, 'cancel', [reason]);
  return sourceCancelPromise.then(() => undefined);
}

function CloseReadableByteStream(stream) {
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'closed';

  if (IsReadableByteStreamLocked(stream)) {
    CloseReadableByteStreamReader(stream._reader);
  }
}

function CloseReadableByteStreamReader(reader) {
  reader._state = 'closed';

  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;

  if (IsReadableByteStreamReader(reader)) {
    for (const req of reader._readRequests) {
      req.resolve(CreateIterResultObject(undefined, true));
    }

    reader._readRequests = [];
  } else {
    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    if (reader._readIntoRequests.length > 0) {
      return;
    }
  }

  DetachReadableByteStreamReader(reader);
}

function DestroyReadableByteStreamController(controller) {
  controller._pendingPullIntos = []
  controller._queue = [];
}

function DetachReadableByteStreamReader(reader) {
  reader._ownerReadableByteStream._reader = undefined;
  reader._ownerReadableByteStream = undefined;
}

function EnqueueInReadableByteStreamController(controller, chunk) {
  controller._queue.push({buffer: chunk.buffer, byteOffset: chunk.byteOffset, byteLength: chunk.byteLength});
  controller._totalQueuedBytes += chunk.byteLength;
}

function ErrorReadableByteStream(stream, e) {
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'errored';
  stream._storedError = e;

  if (IsReadableByteStreamLocked(stream)) {
    ErrorReadableByteStreamReader(stream._reader, e)
  }
}

function ErrorReadableByteStreamReader(reader, e) {
  reader._state = 'errored';
  reader._storedError = e;

  reader._closedPromise_reject(e);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;

  if (IsReadableByteStreamReader(reader)) {
    for (const req of reader._readRequests) {
      req.reject(reader._storedError);
    }

    reader._readRequests = [];
  } else {
    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    for (const req of reader._readIntoRequests) {
      req.reject(reader._storedError);
    }

    reader._readIntoRequests = [];
  }

  DetachReadableByteStreamReader(reader);
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

  return ready;
}

function InitializeReadableByteStreamReader(reader, stream) {
  if (stream._state === 'readable') {
    stream._reader = reader;

    reader._ownerReadableByteStream = stream;
    reader._state = 'readable';
    reader._storedError = undefined;
    reader._closedPromise = new Promise((resolve, reject) => {
      reader._closedPromise_resolve = resolve;
      reader._closedPromise_reject = reject;
    });
  } else if (stream._state === 'closed') {
    reader._ownerReadableByteStream = undefined;
    reader._state = 'closed';
    reader._closedPromise = Promise.resolve(undefined);
    reader._closedPromise_resolve = undefined;
    reader._closedPromise_reject = undefined;
  } else {
    assert(stream._state === 'errored', 'state must be errored');

    reader._ownerReadableByteStream = undefined;
    reader._state = 'errored';
    reader._storedError = stream._storedError;
    reader._closedPromise = Promise.reject(stream._storedError);
    reader._closedPromise_resolve = undefined;
    reader._closedPromise_reject = undefined;
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

function PullFromReadableByteStream(stream) {
  const controller = stream._controller;

  const reader = stream._reader;

  if (reader._readRequests.length > 1) {
    return;
  }

  assert(reader._readRequests.length === 1);

  if (controller._totalQueuedBytes === 0) {
    if (controller._insideUnderlyingByteSource) {
      controller._callPullOrPullIntoLaterIfNeeded = true;
      return;
    }

    ReadableByteStreamControllerCallPull(controller);
    ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);

    return;
  }

  const entry = controller._queue.shift();
  controller._totalQueuedBytes -= entry.byteLength;

  const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);

  const req = reader._readRequests.shift();
  req.resolve(CreateIterResultObject(view, false));

  if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
    CloseReadableByteStream(stream);
  }

  return;
}

function PullFromReadableByteStreamInto(stream, buffer, byteOffset, byteLength, elementSize) {
  const controller = stream._controller;

  const pullIntoDescriptor = {
    buffer,
    byteOffset,
    byteLength,
    bytesFilled: 0,
    elementSize
  };

  if (controller._pendingPullIntos.length > 0) {
    // TODO: Detach buffer.
    controller._pendingPullIntos.push(pullIntoDescriptor);

    return;
  }

  if (controller._totalQueuedBytes === 0) {
    // TODO: Detach buffer.
    controller._pendingPullIntos.push(pullIntoDescriptor);

    if (controller._insideUnderlyingByteSource) {
      controller._callPullOrPullIntoLaterIfNeeded = true;
      return;
    }

    ReadableByteStreamControllerCallPullInto(controller);
    ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);

    return;
  }

  const ready = FillPullIntoDescriptorFromQueue(controller, pullIntoDescriptor);

  if (ready) {
    RespondToReadIntoRequest(stream._reader, pullIntoDescriptor.buffer, pullIntoDescriptor.bytesFilled);

    if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
      CloseReadableByteStream(stream);
    }

    return;
  }

  assert(controller._totalQueuedBytes === 0, 'queue must be empty');
  assert(pullIntoDescriptor.bytesFilled > 0);
  assert(pullIntoDescriptor.bytesFilled < elementSize);

  if (controller._closeRequested) {
    DestroyReadableByteStreamController(controller);
    ErrorReadableByteStream(stream, new TypeError('Insufficient bytes to fill elements in the given buffer'));

    return;
  }

  // TODO: Detach buffer.
  controller._pendingPullIntos.push(pullIntoDescriptor);

  if (controller._insideUnderlyingByteSource) {
    controller._callPullOrPullIntoLaterIfNeeded = true;

    return;
  }

  ReadableByteStreamControllerCallPullInto(controller);
  ReadableByteStreamControllerCallPullOrPullIntoRepeatedlyIfNeeded(controller);
}

function RespondToReadIntoRequest(reader, buffer, length) {
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

function RespondToReadIntoRequestsFromQueue(controller, reader) {
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

      RespondToReadIntoRequest(reader, pullIntoDescriptor.buffer, pullIntoDescriptor.bytesFilled);
    } else {
      assert(controller._totalQueuedBytes === 0, 'queue must be empty');
      assert(pullIntoDescriptor.bytesFilled > 0);
      assert(pullIntoDescriptor.bytesFilled < pullIntoDescriptor.elementSize);
    }
  }
}
