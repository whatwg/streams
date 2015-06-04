const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, typeIsObject } from './helpers';
import { DequeueValue, EnqueueValueWithSize, PeekQueueValue } from './queue-with-sizes';

export default class ReadableByteStream {
  constructor(underlyingByteSource = {}) {
    this._state = 'readable';
    this._reader = undefined;
    this._storedError = undefined;

    this._controller = undefined;
    this._controller = new ReadableByteStreamController(this, underlyingByteSource);
  }

  cacnel(reason) {
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

    return AcquireReadableByteStreamByobReader(this);
  }

  getReader() {
    if (IsReadableByteStream(this) === false) {
      throw new TypeError('ReadableByteStream.prototype.getReader can only be used on a ReadableByteStream');
    }

    return AcquireReadableByteStreamReader(this);
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

    const pullFunction = underlyingByteSource['pull'];
    if (pullFunction !== undefined && typeof pullFunction !== 'function') {
      throw new TypeError('pull property of an underlying byte source must be a function');
    }

    const pullIntoFunction = underlyingByteSource['pullInto'];
    if (pullIntoFunction !== undefined && typeof pullIntoFunction !== 'function') {
      throw new TypeError('pullInto property of an underlying byte source must be a function');
    }

    this._controlledReadableByteStream = controlledReadableByteStream;

    this._underlyingByteSource = underlyingByteSource;

    this._pendingViews = [];

    this._queue = [];
    this._consumedBytesOfHeadOfQueue = 0;

    InvokeOrNoop(underlyingByteSource, 'start', [this]);
  }

  close() {
    if (IsReadableByteStreamController(this) === false) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.close can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }
    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be closed');
    }

    if (this._queue.length === 0) {
      CloseReadableByteStream(stream);
      return undefined;
    }

    this._closeRequested = true;
    return undefined;
  }

  enqueue(chunk) {
    if (IsReadableByteStreamController(this) === false) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.enqueue can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._closeRequested === true) {
      throw new TypeError('stream is closed or draining');
    }

    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be enqueued to');
    }

    const reader = stream._reader;
    if (reader === undefined) {
      EnqueueInReadableByteStreamController(this, chunk);
    } else {
      if (Object.prototype.hasOwnProperty.call(reader, '_readRequests')) {
        if (reader._readRequests.length === 0) {
          EnqueueInReadableByteStreamController(this, chunk);
        } else {
          assert(this._queue.length === 0);
          RespondToReadableByteStreamReaderReadRequest(stream, chunk);
        }
      } else {
        assert(Object.prototype.hasOwnProperty.call(reader, '_readIntoRequest'));
        if (reader._readIntoRequest.length === 0) {
          EnqueueInReadableByteStreamController(this, chunk);
        } else {
          throw new TypeError('pullInto must not be responded by enqueue');
        }
      }
    }

    return undefined;
  }

  error(e) {
    if (IsReadableByteStreamController(this) === false) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.error can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._state !== 'readable') {
      throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
    }

    this._queue = [];

    ErrorReadableByteStream(stream, e);
    return undefined;
  }

  respond(bytesWritten, buffer) {
    if (IsReadableByteStreamController(this) === false) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.respond can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    const reader = stream._reader;

    if (reader === undefined) {
      throw new TypeError('No active reader');
    }

    if (Object.prototype.hasOwnProperty.call(reader, '_readRequests')) {
      throw new TypeError('The active reader is not ReadableByteStreamByobReader');
    }

    assert(Object.prototype.hasOwnProperty.call(reader, '_readIntoRequests'));

    if (reader._readIntoRequests.length === 0) {
      throw new TypeError('No pending read');
    }

    if (this._pendingViews.length === 0) {
      throw new TypeError('No pending read');
    }

    const descriptor = this._pendingViews.shift();
    if (buffer === undefined) {
      buffer = descriptor.buffer;
    }
    const viewType = descriptor.type
    const byteOffset = descriptor.byteOffset;
    const byteLength = descriptor.bytesAlreadyFilled + bytesWritten;
    const chunk = CreateView(viewType, buffer, byteOffset, byteLength);
    RespondToReadableByteStreamReaderReadIntoRequest(stream, chunk);
    return undefined;
  }
}

class ReadableByteStreamReader {
  constructor(stream) {
    if (IsReadableByteStream(stream) === false) {
      throw new TypeError('ReadableByteStreamReader can only be constructed with a ReadableByteStream instance');
    }
    if (IsReadableByteStreamLocked(stream) === true) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    stream._reader = this;
    this._ownerReadableByteStream = stream;
    this._state = 'readable';
    this._storedError = undefined;

    this._readRequests = [];

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    if (stream._state === 'closed' || stream._state === 'errored') {
      ReleaseReadableByteStreamReader(this);
    }
  }

  get closed() {
    if (IsReadableByteStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.closed can only be used on a ReadableByteStreamReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (IsReadableByteStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.cancel can only be used on a ReadableByteStreamReader'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableByteStream !== undefined);

    return CancelReadableByteStream(this._ownerReadableByteStream, reason);
  }

  read() {
    if (IsReadableByteStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableByteStreamReader.prototype.read can only be used on a ReadableByteStreamReader'));
    }

    if (this._state === 'closed') {
      return Promise.resolve(CreateIterResultObject(undefined, true));
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableByteStream !== undefined);
    assert(this._ownerReadableByteStream._state === 'readable');

    const readRequestPromise = new Promise((resolve, reject) => {
      this._readRequests.push({resolve, reject});
    });

    PullFromReadableByteStream(this._ownerReadableByteStream);

    return readRequestPromise;
  }

  releaseLock() {
    if (IsReadableByteStreamReader(this) === false) {
      throw new TypeError(
          'ReadableByteStreamReader.prototype.releaseLock can only be used on a ReadableByteStreamReader');
    }

    if (this._ownerReadableByteStream === undefined) {
      return undefined;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    SyncReadableByteStreamReaderStateWithOwner(this._ownerReadableByteStream);
    DetachReadableByteStreamReader(this);
    return undefined;
  }
}

class ReadableByteStreamByobReader {
  constructor(stream) {
    if (IsReadableByteStream(stream) === false) {
      throw new TypeError('ReadableByteStreamByobReader can only be constructed with a ReadableByteStream instance');
    }
    if (IsReadableByteStreamLocked(stream) === true) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    stream._reader = this;
    this._ownerReadableByteStream = stream;
    this._state = 'readable';
    this._storedError = undefined;

    this._readIntoRequests = [];

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    if (stream._state === 'closed' || stream._state === 'errored') {
      ReleaseReadableByteStreamReader(this);
    }
  }

  get closed() {
    if (IsReadableByteStreamByobReader(this) === false) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.closed can only be used on a ReadableByteStreamByobReader'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (IsReadableByteStreamByobReader(this) === false) {
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

    assert(this._ownerReadableByteStream !== undefined);

    return CancelReadableByteStream(this._ownerReadableByteStream, reason);
  }

  read(view) {
    if (IsReadableByteStreamByobReader(this) === false) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.read can only be used on a ReadableByteStreamByobReader'));
    }

    if (this._ownerReadableByteStream === undefined) {
      if (this._state === 'closed') {
        return Promise.resolve(CreateIterResultObject(view, true));
      }

      assert(this._state === 'errored');
      return Promise.reject(this._storedError);
    }

    const readRequestPromise = new Promise((resolve, reject) => {
      this._readIntoRequests.push({resolve, reject});
    });

    PullFromReadableByteStreamInto(this._ownerReadableByteStream, view);

    return readRequestPromise;
  }

  releaseLock() {
    if (IsReadableByteStreamByobReader(this) === false) {
      throw new TypeError(
          'ReadableByteStreamByobReader.prototype.releaseLock can only be used on a ReadableByteStreamByobReader');
    }

    if (this._ownerReadableByteStream === undefined) {
      return undefined;
    }

    if (this._readIntoRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    SyncReadableByteStreamReaderStateWithOwner(this._ownerReadableByteStream);
    DetachReadableByteStreamReader(this);
    return undefined;
  }
}


function AcquireReadableByteStreamByobReader(stream) {
  return new ReadableByteStreamByobReader(stream);
}

function AcquireReadableByteStreamReader(stream) {
  return new ReadableByteStreamReader(stream);
}

function CancelReadableByteStream(stream, reason) {
  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  CloseReadableByteStream(stream);
  stream._controller._queue = [];

  const sourceCancelPromise = PromiseInvokeOrNoop(stream._underlyingByteSource, 'cancel', [reason]);
  return sourceCancelPromise.then(() => undefined);
}

function CloseReadableByteStream(stream) {
  assert(IsReadableByteStream(stream) === true);
  assert(stream._state === 'readable');

  stream._state = 'closed';

  ReleaseReadableByteStreamReader(stream);
  return undefined;
}

function CreateView(type, buffer, byteOffset, byteLength) {
  if (type === 'DataView') {
    return new DataView(buffer, byteOffset, byteLength);
  } else if (type === 'Int8Array') {
    return new Int8Array(buffer, byteOffset, byteLength);
  } else if (type === 'Uint8Array') {
    return new Uint8Array(buffer, byteOffset, byteLength);
  } else if (type === 'Int16Array') {
    const elementSize = 2;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Int16Array(buffer, byteOffset, byteLength / elementSize);
  } else if (type === 'Uint16Array') {
    const elementSize = 2;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Uint16Array(buffer, byteOffset, byteLength / elementSize);
  } else if (type === 'Int32Array') {
    const elementSize = 4;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Int32Array(buffer, byteOffset, byteLength / elementSize);
  } else if (type === 'Uint32Array') {
    const elementSize = 4;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Uint32Array(buffer, byteOffset, byteLength / elementSize);
  } else if (type === 'Float32Array') {
    const elementSize = 4;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Float32Array(buffer, byteOffset, byteLength / elementSize);
  } else if (type === 'Float64Array') {
    const elementSize = 8;
    if (byteLength % elementSize !== 0) {
      throw new TypeError('Not aligned');
    }
    return new Float64Array(buffer, byteOffset, byteLength / elementSize);
  } else {
    throw new TypeError('Descriptor is broken');
  }
}

function DetachReadableByteStreamReader(stream) {
  assert(stream._reader !== undefined);
  stream._reader._ownerReadableByteStream = undefined;
  stream._reader = undefined;
}

function EnqueueInReadableByteStreamController(controller, chunk) {
  try {
    EnqueueValueWithSize(controller._queue, chunk, 1);
  } catch (enqueueE) {
    ErrorReadableByteStream(controller._controlledReadableByteStream, enqueueE);
    throw enqueueE;
  }
}

function ErrorReadableByteStream(stream, e) {
  assert(IsReadableByteStream(stream) === true);
  assert(stream._state === 'readable');

  stream._storedError = e;
  stream._state = 'errored';

  ReleaseReadableByteStreamReader(stream);
  return undefined;
}

function FlushReadableByteStreamReaderReadRequests(stream) {
  assert(stream._reader !== undefined);
  const reader = stream._reader;

  if (stream._state === 'errored') {
    for (const { _reject } of reader._readRequests) {
      _reject(stream._storedError);
    }
  } else {
    for (const { _resolve } of reader._readRequests) {
      _resolve(CreateIterResultObject(undefined, true));
    }
  }

  reader._readRequests = [];
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

function IsReadableByteStreamLocked(stream) {
  assert(IsReadableByteStream(stream) === true,
         'IsReadableByteStreamLocked should only be used on known readable byte streams');

  if (stream._reader === undefined) {
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

function IsReadableByteStreamByobReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_readIntoRequests')) {
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

function PopBytesFromQueue(controller) {
  const queue = controller._queue;

  let chunk = PeekQueueValue(queue);
  DequeueValue(queue);
  const bytesAlreadyConsumed = controller._consumedBytesOfHeadOfQueue;
  if (bytesAlreadyConsumed !== 0) {
    const buffer = chunk.buffer;
    const byteLength = chunk.byteLength;
    const byteOffset = chunk.byteOffset;
    chunk = new Uint8Array(buffer, byteOffset + bytesAlreadyConsumed, byteLength - bytesAlreadyConsumed);
    controller._consumedBytesOfHeadOfQueue = 0;
  }

  return chunk;
}

function PullFromReadableByteStream(stream) {
  const controller  = stream._controller;
  const queue = controller._queue;
  if (queue.length === 0) {
    try {
      controller._underlyingByteSource.pull();
    } catch (e) {
      if (stream._state === 'readable') {
        ErrorReadableByteStream(stream, e);
      }
    }
    return undefined;
  }

  let chunk;
  try {
    chunk = PopBytesFromQueue(controller);
  } catch (e) {
    ErrorReadableByteStream(stream, e);
    return undefined;
  }

  RespondToReadableByteStreamReaderReadRequest(stream, chunk);
  if (queue.length === 0 && controller._closeRequested === true) {
    CloseReadableByteStream(stream);
  }

  return undefined;
}

function PullFromReadableByteStreamInto(stream, view) {
  const controller = stream._controller;

  const queue = controller._queue;

  const destBuffer = view.buffer;
  const destByteOffset = view.byteOffset;
  const destByteLength = view.byteLength;

  let destBytesFilled = 0;

  while (queue.length > 0) {
    const headOfQueue = PeekQueueValue(queue);

    const srcBuffer = headOfQueue.buffer;
    const srcByteOffset = headOfQueue.byteOffset;
    const srcByteLength = headOfQueue.byteLength;

    let srcBytesConsumed = controller._consumedBytesOfHeadOfQueue;

    let bytesToCopy = srcByteLength - srcBytesConsumed;
    const destRemaining = destByteLength - destBytesFilled;
    if (bytesToCopy > destRemaining) {
      bytesToCopy = destRemaining;
    }

    const srcStart = srcByteOffset + srcBytesConsumed;
    const destStart = destByteOffset + destBytesFilled;
    new Uint8Array(destBuffer).set(new Uint8Array(srcBuffer, srcStart, bytesToCopy), destStart);

    srcBytesConsumed += bytesToCopy;
    destBytesFilled += bytesToCopy;

    if (srcBytesConsumed < srcByteLength) {
      controller._consumedBytesOfHeadOfQueue = srcBytesConsumed;
      break;
    }

    DequeueValue(queue);
    controller._consumedBytesOfHeadOfQueue = 0;
  }

  let type;
  let elementSize = 1;
  if (view.constructor === DataView) {
    type = 'DataView';
  } else if (view.constructor === Int8Array) {
    type = 'Int8Array';
  } else if (view.constructor === Uint8Array) {
    type = 'Uint8Array';
  } else if (view.constructor === Uint8ClampedArray) {
    type = 'Uint8ClampedArray';
  } else if (view.constructor === Int16Array) {
    type = 'Int16Array';
    elementSize = 2;
  } else if (view.constructor === Uint16Array) {
    type = 'Uint16Array';
    elementSize = 2;
  } else if (view.constructor === Int32Array) {
    type = 'Int32Array';
    elementSize = 4;
  } else if (view.constructor === Uint32Array) {
    type = 'Uint32Array';
    elementSize = 4;
  } else if (view.constructor === Float32Array) {
    type = 'Float32Array';
    elementSize = 4;
  } else if (view.constructor === Float64Array) {
    type = 'Float64Array';
    elementSize = 8;
  } else {
    ErrorReadableByteStream(stream, new TypeError('Unknown ArrayBufferView type'));
    return undefined;
  }

  if (destBytesFilled % elementSize === 0) {
    const newView = CreateView(type, destBuffer, destByteOffset, destBytesFilled);

    RespondToReadableByteStreamReaderReadIntoRequest(stream, newView);

    if (queue.length === 0 && controller._closeRequested === true) {
      CloseReadableByteStream(stream);
    }

    return undefined;
  } else if (queue.length === 0 && controller._closeRequested === true) {
    ErrorReadableByteStream(stream, new TypeError('Insufficient bytes to fill elements in the given buffer'));

    return undefined;
  }

  // TODO: Detach destBuffer here.
  controller._pendingViews.push(
      {buffer: destBuffer, byteOffset: destByteOffset, bytesAlreadyFilled: destBytesFilled, type});
  try {
    controller._underlyingByteSource.pullInto(
        destBuffer, destByteOffset + destBytesFilled, destByteLength - destBytesFilled);
  } catch (e) {
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  return undefined;
}

function ReleaseReadableByteStreamReader(stream) {
  const reader = stream._reader;
  if (reader === undefined) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(reader, '_readRequests')) {
    SyncReadableByteStreamReaderStateWithOwner(stream);
    FlushReadableByteStreamReaderReadRequests(stream);
    DetachReadableByteStreamReader(reader);
    return undefined;
  }

  assert(Object.prototype.hasOwnProperty.call(reader, '_readIntoRequests'));
  SyncReadableByteStreamReaderStateWithOwner(stream);
  if (reader._readIntoRequests.length === 0) {
    DetachReadableByteStreamReader(stream);
    return undefined;
  }
}

function RespondToReadableByteStreamReaderReadRequest(stream, chunk) {
  assert(stream._state === 'readable');
  assert(stream._reader._readRequests.length !== 0);

  const request = stream._reader._readRequests.shift();
  request.resolve(CreateIterResultObject(chunk, false));
  return undefined;
}

function RespondToReadableByteStreamReaderReadIntoRequest(stream, chunk) {
  assert(stream._reader !== undefined);
  assert(stream._reader._readIntoRequests.length !== 0);

  const reader = stream._reader;
  const request = reader._readIntoRequests.shift();
  if (stream._state === 'readable') {
    request.resolve(CreateIterResultObject(chunk, false));
    return undefined;
  }
  if (stream._state == 'closed') {
    request.resolve(CreateIterResultObject(chunk, true));
  } else {
    assert(reader._state === 'errored');
    request.reject(stream._storedError);
  }
  if (reader._readIntoRequests.length === 0) {
    DetachReadableByteStreamReader(stream);
  }

  return undefined;
}

function SyncReadableByteStreamReaderStateWithOwner(stream) {
  assert(stream._reader !== undefined);

  const reader = stream._reader;
  const e = stream._storedError;
  if (stream._state === 'errored') {
    reader._state = 'errored';
    reader._storedError = e;
    reader._closedPromise_reject(e);
  } else {
    reader._state = 'closed';
    reader._closedPromise = undefined;
  }
}
