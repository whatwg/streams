const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, typeIsObject } from './helpers';

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

    this._pendingPulls = [];

    this._queue = [];
    this._consumedBytesOfHeadOfQueue = 0;
    this._totalBytes = 0;

    InvokeOrNoop(underlyingByteSource, 'start', [this]);
  }

  close() {
    if (!IsReadableByteStreamController(this)) {
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

    if (!IsReadableByteStreamLocked(stream)) {
      if (this._queue.length === 0) {
        CloseReadableByteStream(stream);

        return undefined;
      }

      this._closeRequested = true;

      return undefined;
    }

    const reader = stream._reader;

    if (IsReadableByteStreamReader(reader)) {
      if (this._queue.length === 0) {
        CloseReadableByteStream(stream);

        return undefined;
      }

      this._closeRequested = true;

      return undefined;
    }

    assert(IsReadableByteStreamByobReader(reader));

    if (this._pendingPulls.length > 0 && this._pendingPulls[0].bytesFilled > 0) {
      ErrorReadableByteStream(stream, new TypeError('Insufficient bytes to fill elements in the given buffer'));

      return undefined;
    }

    if (this._queue.length === 0) {
      CloseReadableByteStream(stream);

      return undefined;
    }

    this._closeRequested = true;

    return undefined;
  }

  enqueue(chunk) {
    if (!IsReadableByteStreamController(this)) {
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

    if (!IsReadableByteStreamLocked(stream)) {
      EnqueueInReadableByteStreamController(this, chunk);

      return undefined;
    }

    const reader = stream._reader;

    if (IsReadableByteStreamReader(reader)) {
      if (reader._readRequests.length === 0) {
        EnqueueInReadableByteStreamController(this, chunk);

        return undefined;
      }

      assert(this._queue.length === 0);

      RespondToReadableByteStreamReaderReadRequest(reader, chunk);

      return undefined;
    }

    assert(IsReadableByteStreamByobReader(reader));

    EnqueueInReadableByteStreamController(this, chunk);

    if (this._pendingPulls.length > 0) {
      ProcessPullRequest(stream, this._pendingPulls.shift());
    }

    return undefined;
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

    this._pendingPulls = [];
    this._queue = [];

    ErrorReadableByteStream(stream, e);

    return undefined;
  }

  respond(bytesWritten, buffer) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.respond can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (this._pendingPulls.length === 0) {
      throw new TypeError('No pending BYOB read');
    }

    assert(IsReadableByteStreamLocked(stream));

    const reader = stream._reader;

    assert(IsReadableByteStreamByobReader(reader));

    const descriptor = this._pendingPulls[0];

    if (buffer !== undefined) {
      descriptor.buffer = buffer;
    }

    if (stream._state === 'closed') {
      if (bytesWritten !== 0) {
        throw new TypeError('bytesWritten must be 0 when calling respond() on a closed stream');
      }

      assert(descriptor.bytesFilled === 0);

      const result = CreateView(descriptor.viewType, descriptor.buffer, descriptor.byteOffset, 0);

      this._pendingPulls.shift();

      RespondToReadableByteStreamByobReaderReadIntoRequest(reader, result.view);

      return undefined;
    }

    descriptor.bytesFilled += bytesWritten;

    const result = CreateView(descriptor.viewType, descriptor.buffer, descriptor.byteOffset, descriptor.bytesFilled);
    if (result.bytesUsed > 0) {
      this._pendingPulls.shift();

      RespondToReadableByteStreamByobReaderReadIntoRequest(reader, result.view);
      if (result.bytesUsed < descriptor.bytesFilled) {
        EnqueueInReadableByteStreamController(this, buffer.slice(result.bytesUsed, descriptor.bytesFilled));

        if (this._pendingPulls.length > 0) {
          while (ProcessPullRequest(stream, this._pendingPulls.shift())) {}
        }
      }
    } else {
      try {
        controller._underlyingByteSource.pullInto(descriptor.buffer,
                                                  descriptor.byteOffset + descriptor.bytesFilled,
                                                  descriptor.byteLength - descriptor.bytesFilled);
      } catch (e) {
        if (stream._state === 'readable') {
          ErrorReadableByteStream(stream, e);
        }
      }
    }

    return undefined;
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

    assert(this._ownerReadableByteStream !== undefined);

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

    assert(this._ownerReadableByteStream !== undefined);
    assert(this._ownerReadableByteStream._state === 'readable');

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
      return undefined;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    UpdateReaderForRelease(this._ownerReadableByteStream, this);
    DetachReadableByteStreamReader(this);

    return undefined;
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

    assert(this._ownerReadableByteStream !== undefined);

    return CancelReadableByteStream(this._ownerReadableByteStream, reason);
  }

  read(view) {
    if (!IsReadableByteStreamByobReader(this)) {
      return Promise.reject(
        new TypeError(
            'ReadableByteStreamByobReader.prototype.read can only be used on a ReadableByteStreamByobReader'));
    }

    if (this._state === 'errored') {
      assert(this._ownerReadableByteStream === undefined);

      return Promise.reject(this._storedError);
    }

    if (this._state === 'closed' && this._ownerReadableByteStream === undefined) {
      return Promise.resolve(CreateIterResultObject(view, true));
    }

    const promise = new Promise((resolve, reject) => {
      this._readIntoRequests.push({resolve, reject});
    });

    PullFromReadableByteStreamInto(this._ownerReadableByteStream, view);

    return promise;
  }

  releaseLock() {
    if (!IsReadableByteStreamByobReader(this)) {
      throw new TypeError(
          'ReadableByteStreamByobReader.prototype.releaseLock can only be used on a ReadableByteStreamByobReader');
    }

    if (this._ownerReadableByteStream === undefined) {
      return undefined;
    }

    if (this._readIntoRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    UpdateReaderForRelease(this._ownerReadableByteStream, this);
    DetachReadableByteStreamReader(this);

    return undefined;
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
    return {view: new DataView(buffer, byteOffset, byteLength), bytesUsed: byteLength};
  } else if (type === 'Int8Array') {
    return {view: new Int8Array(buffer, byteOffset, byteLength), bytesUsed: byteLength};
  } else if (type === 'Uint8Array') {
    return {view: new Uint8Array(buffer, byteOffset, byteLength), bytesUsed: byteLength};
  } else if (type === 'Int16Array') {
    const elementSize = 2;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Int16Array(buffer, byteOffset, byteUsed / elementSize), bytesUsed};
  } else if (type === 'Uint16Array') {
    const elementSize = 2;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Uint16Array(buffer, byteOffset, byteLength / elementSize), bytesUsed};
  } else if (type === 'Int32Array') {
    const elementSize = 4;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Int32Array(buffer, byteOffset, byteLength / elementSize), bytesUsed};
  } else if (type === 'Uint32Array') {
    const elementSize = 4;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Uint32Array(buffer, byteOffset, byteLength / elementSize), bytesUsed};
  } else if (type === 'Float32Array') {
    const elementSize = 4;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Float32Array(buffer, byteOffset, byteLength / elementSize), bytesUsed};
  } else if (type === 'Float64Array') {
    const elementSize = 8;
    const bytesUsed = byteLength - byteLength % elementSize;
    return {view: new Float64Array(buffer, byteOffset, byteLength / elementSize), bytesUsed};
  } else {
    throw new TypeError('Descriptor is broken');
  }
}

function DetachReadableByteStreamReader(stream) {
  assert(stream._reader !== undefined);

  stream._reader._ownerReadableByteStream = undefined;
  stream._reader = undefined;

  return undefined;
}

function EnqueueInReadableByteStreamController(controller, chunk) {
  try {
    controller._queue.push(chunk);
    controller._totalBytes += chunk.byteLength;
  } catch (e) {
    ErrorReadableByteStream(controller._controlledReadableByteStream, e);
    throw e;
  }

  return undefined;
}

function ErrorReadableByteStream(stream, e) {
  assert(IsReadableByteStream(stream) === true);
  assert(stream._state === 'readable');

  stream._storedError = e;
  stream._state = 'errored';

  ReleaseReadableByteStreamReader(stream);

  return undefined;
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

  let chunk = queue.shift();
  const bytesAlreadyConsumed = controller._consumedBytesOfHeadOfQueue;
  const buffer = chunk.buffer;
  const byteOffset = chunk.byteOffset + bytesAlreadyConsumed;
  const byteLength = chunk.byteLength - bytesAlreadyConsumed;

  controller._consumedBytesOfHeadOfQueue = 0;
  controller._totalBytes -= byteLength;

  return new Uint8Array(buffer, byteOffset, byteLength);
}

function ProcessPullRequest(stream, descriptor) {
  const controller = stream._controller;

  const queue = controller._queue;

  const destBuffer = descriptor.buffer;
  const destByteOffset = descriptor.byteOffset;

  const elementSize = descriptor.elementSize;
  let maxBytesToCopy = Math.min(controller._totalBytes, descriptor.byteLength - descriptor.bytesFilled);
  const currentNumElements = (descriptor.bytesFilled - descriptor.bytesFilled % elementSize) / elementSize;
  const maxBytesFilled = descriptor.bytesFilled + maxBytesToCopy;
  const maxNumElements = (maxBytesFilled - maxBytesFilled % elementSize) / elementSize;
  let respond = false;
  let totalBytesToCopyRemaining = maxBytesToCopy;
  if (maxNumElements > currentNumElements) {
    respond = true;
    totalBytesToCopyRemaining = maxNumElements * elementSize - descriptor.bytesFilled;
  }

  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];

    const srcBuffer = headOfQueue.buffer;
    const srcByteOffset = headOfQueue.byteOffset;
    let srcByteLength = headOfQueue.byteLength;

    let srcBytesConsumed = controller._consumedBytesOfHeadOfQueue;

    const bytesToCopy = Math.min(totalBytesToCopyRemaining, srcByteLength - srcBytesConsumed);

    const srcStart = srcByteOffset + srcBytesConsumed;
    const destStart = destByteOffset + descriptor.bytesFilled;
    new Uint8Array(destBuffer).set(new Uint8Array(srcBuffer, srcStart, bytesToCopy), destStart);

    srcBytesConsumed += bytesToCopy;
    descriptor.bytesFilled += bytesToCopy;

    totalBytesToCopyRemaining -= bytesToCopy
    controller._totalBytes -= bytesToCopy;

    if (srcBytesConsumed === srcByteLength) {
      queue.shift();
      controller._consumedBytesOfHeadOfQueue = 0;
    } else {
      controller._consumedBytesOfHeadOfQueue = srcBytesConsumed;
    }
  }

  if (respond) {
    const result = CreateView(descriptor.viewType, destBuffer, destByteOffset, descriptor.bytesFilled);
    assert(result.bytesUsed === descriptor.bytesFilled);
    RespondToReadableByteStreamByobReaderReadIntoRequest(stream._reader, result.view);

    if (queue.length === 0 && controller._closeRequested === true) {
      CloseReadableByteStream(stream);
    }

    return true;
  } else if (queue.length === 0 && controller._closeRequested === true) {
    if (descriptor.bytesFilled === 0) {
      CloseReadableByteStream(stream);
    } else {
      ErrorReadableByteStream(stream, new TypeError('Insufficient bytes to fill elements in the given buffer'));
    }

    return false;
  }

  // TODO: Detach destBuffer here.
  controller._pendingPulls.push(descriptor);
  try {
    controller._underlyingByteSource.pullInto(
        destBuffer, destByteOffset + descriptor.bytesFilled, descriptor.byteLength - descriptor.bytesFilled);
  } catch (e) {
    if (stream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }

  return false;
}

function PullFromReadableByteStream(stream) {
  const controller  = stream._controller;

  const queue = controller._queue;

  if (queue.length === 0) {
    try {
      controller._underlyingByteSource.pull();
    } catch (e) {
      if (stream._state === 'readable') {
        controller._queue = undefined;
        ErrorReadableByteStream(stream, e);
      }
    }
    return undefined;
  }

  let chunk;
  try {
    chunk = PopBytesFromQueue(controller);
  } catch (e) {
    controller._queue = undefined;
    ErrorReadableByteStream(stream, e);

    return undefined;
  }

  RespondToReadableByteStreamReaderReadRequest(stream._reader, chunk);

  if (queue.length === 0 && controller._closeRequested === true) {
    CloseReadableByteStream(stream);
  }

  return undefined;
}

function PullFromReadableByteStreamInto(stream, view) {
  let viewType;
  let elementSize = 1;
  if (view.constructor === DataView) {
    viewType = 'DataView';
  } else if (view.constructor === Int8Array) {
    viewType = 'Int8Array';
  } else if (view.constructor === Uint8Array) {
    viewType = 'Uint8Array';
  } else if (view.constructor === Uint8ClampedArray) {
    viewType = 'Uint8ClampedArray';
  } else if (view.constructor === Int16Array) {
    viewType = 'Int16Array';
    elementSize = 2;
  } else if (view.constructor === Uint16Array) {
    viewType = 'Uint16Array';
    elementSize = 2;
  } else if (view.constructor === Int32Array) {
    viewType = 'Int32Array';
    elementSize = 4;
  } else if (view.constructor === Uint32Array) {
    viewType = 'Uint32Array';
    elementSize = 4;
  } else if (view.constructor === Float32Array) {
    viewType = 'Float32Array';
    elementSize = 4;
  } else if (view.constructor === Float64Array) {
    viewType = 'Float64Array';
    elementSize = 8;
  } else {
    ErrorReadableByteStream(stream, new TypeError('Unknown ArrayBufferView type'));
    return undefined;
  }

  const descriptor = {
    buffer: view.buffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    bytesFilled: 0,
    viewType,
    elementSize
  };

  ProcessPullRequest(stream, descriptor);

  return undefined;
}

function ReleaseReadableByteStreamReader(stream) {
  if (!IsReadableByteStreamLocked(stream)) {
    return undefined;
  }

  const reader = stream._reader;

  if (IsReadableByteStreamReader(reader)) {
    UpdateReaderForRelease(stream, reader);

    if (stream._state === 'errored') {
      for (const req of reader._readRequests) {
        req.reject(stream._storedError);
      }
    } else {
      for (const req of reader._readRequests) {
        req.resolve(CreateIterResultObject(undefined, true));
      }
    }

    reader._readRequests = [];

    DetachReadableByteStreamReader(stream);

    return undefined;
  }

  assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

  UpdateReaderForRelease(stream, reader);

  if (stream._state === 'errored') {
    for (const req of reader._readIntoRequests) {
      req.reject(stream._storedError);
    }

    reader._readIntoRequests = [];

    DetachReadableByteStreamReader(stream);

    return undefined;
  }

  if (reader._readIntoRequests.length === 0) {
    DetachReadableByteStreamReader(stream);
  }

  return undefined;
}

function RespondToReadableByteStreamReaderReadRequest(reader, chunk) {
  assert(reader._readRequests.length > 0,
         'readRequest must not be empty when calling RespondToReadableByteStreamReaderReadRequest');

  const req = reader._readRequests.shift();
  req.resolve(CreateIterResultObject(chunk, false));
  return undefined;
}

function RespondToReadableByteStreamByobReaderReadIntoRequest(reader, chunk) {
  assert(reader._readIntoRequests.length > 0,
         'readIntoRequest must not be empty when calling RespondToReadableByteStreamByobReaderReadIntoRequest');

  const req = reader._readIntoRequests.shift();

  if (reader._state === 'readable') {
    req.resolve(CreateIterResultObject(chunk, false));

    return undefined;
  }

  assert(reader._state == 'closed');

  req.resolve(CreateIterResultObject(chunk, true));

  if (reader._readIntoRequests.length === 0) {
    DetachReadableByteStreamReader(reader._ownerReadableByteStream);
  }

  return undefined;
}

function UpdateReaderForRelease(stream, reader) {
  if (stream._state === 'errored') {
    reader._state = 'errored';
    reader._storedError = stream._storedError;

    reader._closedPromise_reject(stream._storedError);
    reader._closedPromise_resolve = undefined;
    reader._closedPromise_reject = undefined;

    return undefined;
  }

  reader._state = 'closed';

  reader._closedPromise_resolve(undefined);
  reader._closedPromise_resolve = undefined;
  reader._closedPromise_reject = undefined;

  return undefined;
}
