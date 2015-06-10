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

    this._considerReissueUnderlyingByteSourcePull = false;
    this._insideUnderlyingByteSource = false;

    this._pendingPullIntos = [];

    this._queue = [];
    this._totalQueuedBytes = 0;

    InvokeOrNoop(underlyingByteSource, 'start', [this]);
  }

  close() {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.close can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._closeRequested) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }
    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be closed');
    }

    if (this._totalQueuedBytes > 0) {
      this._closeRequested = true;

      return undefined;
    }

    if (!IsReadableByteStreamLocked(stream)) {
      CloseReadableByteStream(stream);

      return undefined;
    }

    const reader = stream._reader;

    if (IsReadableByteStreamReader(reader)) {
      CloseReadableByteStream(stream);

      return undefined;
    }

    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    if (this._pendingPullIntos.length > 0 && this._pendingPullIntos[0].bytesFilled > 0) {
      DestroyReadableByteStreamController(this);
      const e = new TypeError('Insufficient bytes to fill elements in the given buffer');
      ErrorReadableByteStream(stream, e);

      throw e;
    }

    CloseReadableByteStream(stream);

    return undefined;
  }

  enqueue(chunk) {
    if (!IsReadableByteStreamController(this)) {
      throw new TypeError(
          'ReadableByteStreamController.prototype.enqueue can only be used on a ReadableByteStreamController');
    }

    const stream = this._controlledReadableByteStream;

    if (stream._closeRequested) {
      throw new TypeError('stream is closed or draining');
    }
    if (stream._state !== 'readable') {
      throw new TypeError('The stream is not in the readable state and cannot be enqueued to');
    }

    const reader = stream._reader;

    if (reader === undefined) {
      EnqueueInReadableByteStreamController(this, chunk);

      return undefined;
    }

    if (IsReadableByteStreamReader(reader)) {
      if (reader._readRequests.length === 0) {
        EnqueueInReadableByteStreamController(this, chunk);

        return undefined;
      }

      assert(this._queue.length === 0);

      const req = reader._readRequests.shift();
      // TODO: Detach chunk.
      req.resolve(CreateIterResultObject(chunk, false));

      if (this._closeRequested === true) {
        CloseReadableByteStream(stream);

        return undefined;
      }

      if (reader._readRequests.length > 0) {
        if (this._insideUnderlyingByteSource) {
          this._considerReissueUnderlyingByteSourcePull = true;

          return undefined;
        }

        ReadableByteStreamControllerCallPull(this);

        Promise.resolve().then(MaybeCallPullOrPullIntoRepeatedly.bind(undefined, this));
      }

      return undefined;
    }

    assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

    EnqueueInReadableByteStreamController(this, chunk);
    ConsumeQueueForReadableByteStreamByobReaderReadIntoRequest(this, reader);

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

    DestroyReadableByteStreamController(this);
    ErrorReadableByteStream(stream, e);

    return undefined;
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
        const result = CreateArrayBufferViewFromPullIntoDescriptor(descriptor);
        const req = reader._readIntoRequests.shift();
        req.resolve(CreateIterResultObject(result.view, true));
      }

      DetachReadableByteStreamReader(reader);

      return undefined;
    }

    pullIntoDescriptor.bytesFilled += bytesWritten;

    const result = CreateArrayBufferViewFromPullIntoDescriptor(pullIntoDescriptor);
    if (result.bytesUsed > 0) {
      this._pendingPullIntos.shift();

      let remainder;
      if (result.bytesUsed < pullIntoDescriptor.bytesFilled) {
        remainder = buffer.slice(result.bytesUsed, pullIntoDescriptor.bytesFilled);
      }

      RespondToReadableByteStreamByobReaderReadIntoRequest(reader, result.view);

      if (remainder !== undefined) {
        EnqueueInReadableByteStreamController(this, remainder);
      }

      ConsumeQueueForReadableByteStreamByobReaderReadIntoRequest(this, reader);

      return undefined;
    }

    if (this._insideUnderlyingByteSource) {
      this._considerReissueUnderlyingByteSourcePull = true;

      return undefined;
    }

    Promise.resolve().then(MaybeCallPullOrPullIntoRepeatedly.bind(undefined, controller));

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
      return undefined;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    if (this._ownerReadableByteStream._state === 'errored') {
      MarkReadableByteStreamReaderErrored(this, this._ownerReadableByteStream._storedError)
    } else {
      CloseReadableByteStreamReader(this);
    }

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

    if (this._state === 'errored') {
      assert(this._ownerReadableByteStream === undefined, 'This reader must be detached');

      return Promise.reject(this._storedError);
    }

    if (this._state === 'closed' && this._ownerReadableByteStream === undefined) {
      return Promise.resolve(CreateIterResultObject(new view.constructor(view.buffer, view.byteOffset, 0), true));
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

    if (this._ownerReadableByteStream._state === 'readable') {
      CloseReadableByteStreamReader(this);
    }

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
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'closed';

  if (IsReadableByteStreamLocked(stream)) {
    CloseReadableByteStreamReader(stream._reader);
  }

  return undefined;
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
      return undefined;
    }
  }

  DetachReadableByteStreamReader(reader);

  return undefined;
}

function ConsumeQueueForReadableByteStreamByobReaderReadIntoRequest(controller, reader) {
  assert(!controller._closeRequested);

  const stream = controller._controlledReadableByteStream;

  while (controller._pendingPullIntos.length > 0) {
    if (controller._totalQueuedBytes === 0) {
      if (controller._insideUnderlyingByteSource) {
        controller._considerReissueUnderlyingByteSourcePull = true;

        return undefined;
      }

      ReadableByteStreamControllerCallPullInto(controller);

      Promise.resolve().then(MaybeCallPullOrPullIntoRepeatedly.bind(undefined, controller));

      return undefined;
    }

    const pullIntoDescriptor = controller._pendingPullIntos[0];

    const ready = FillPendingPullFromQueue(controller, pullIntoDescriptor);

    if (ready) {
      controller._pendingPullIntos.shift();

      const result = CreateArrayBufferViewFromPullIntoDescriptor(pullIntoDescriptor);
      assert(result.bytesUsed === pullIntoDescriptor.bytesFilled, 'All filled bytes must be used');
      RespondToReadableByteStreamByobReaderReadIntoRequest(reader, result.view);
    } else {
      assert(controller._totalQueuedBytes === 0, 'queue must be empty');
    }
  }

  return undefined;
}

function CreateArrayBufferViewFromPullIntoDescriptor(descriptor) {
  const type = descriptor.viewType;
  const buffer = descriptor.buffer;
  const byteOffset = descriptor.byteOffset;
  const byteLength = descriptor.bytesFilled;

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

function DestroyReadableByteStreamController(controller) {
  controller._pendingPullIntos = []
  controller._queue = [];
}

function DetachReadableByteStreamReader(reader) {
  reader._ownerReadableByteStream._reader = undefined;
  reader._ownerReadableByteStream = undefined;

  return undefined;
}

function EnqueueInReadableByteStreamController(controller, chunk) {
  controller._queue.push({buffer: chunk.buffer, byteOffset: chunk.byteOffset, byteLength: chunk.byteLength});
  controller._totalQueuedBytes += chunk.byteLength;

  return undefined;
}

function ErrorReadableByteStream(stream, e) {
  assert(IsReadableByteStream(stream), 'stream must be ReadableByteStream');
  assert(stream._state === 'readable', 'state must be readable');

  stream._state = 'errored';
  stream._storedError = e;

  if (IsReadableByteStreamLocked(stream)) {
    ErrorReadableByteStreamReader(stream._reader, e)
  }

  return undefined;
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

  return undefined;
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

    reader._ownerReadableByteStream = stream;
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

function IsReadableByteStreamLocked(stream) {
  assert(IsReadableByteStream(stream),
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

function FillPendingPullFromQueue(controller, descriptor) {
  const elementSize = descriptor.elementSize;

  const currentNumElements = (descriptor.bytesFilled - descriptor.bytesFilled % elementSize) / elementSize;

  const maxBytesToCopy = Math.min(controller._totalQueuedBytes, descriptor.byteLength - descriptor.bytesFilled);
  const maxBytesFilled = descriptor.bytesFilled + maxBytesToCopy;
  const maxNumElements = (maxBytesFilled - maxBytesFilled % elementSize) / elementSize;

  let totalBytesToCopyRemaining = maxBytesToCopy;
  let ready = false;
  if (maxNumElements > currentNumElements) {
    totalBytesToCopyRemaining = maxNumElements * elementSize - descriptor.bytesFilled;
    ready = true;
  }

  const queue = controller._queue;

  while (totalBytesToCopyRemaining > 0) {
    const headOfQueue = queue[0];

    const bytesToCopy = Math.min(totalBytesToCopyRemaining, headOfQueue.byteLength);

    const destStart = descriptor.byteOffset + descriptor.bytesFilled;
    new Uint8Array(descriptor.buffer).set(
        new Uint8Array(headOfQueue.buffer, headOfQueue.byteOffset, bytesToCopy), destStart);

    if (headOfQueue.byteLength === bytesToCopy) {
      queue.shift();
    } else {
      headOfQueue.byteOffset += bytesToCopy;
      headOfQueue.byteLength -= bytesToCopy;
    }

    controller._totalQueuedBytes -= bytesToCopy;

    descriptor.bytesFilled += bytesToCopy;

    totalBytesToCopyRemaining -= bytesToCopy
  }

  return ready;
}

function ReadableByteStreamControllerCallPullInto(controller) {
  controller._considerReissueUnderlyingByteSourcePull = false;

  controller._insideUnderlyingByteSource = true;

  assert(controller._pendingPullIntos.length > 0);
  const pullIntoDescriptor = controller._pendingPullIntos[0];

  try {
    controller._underlyingByteSource.pullInto(pullIntoDescriptor.buffer,
                                              pullIntoDescriptor.byteOffset + pullIntoDescriptor.bytesFilled,
                                              pullIntoDescriptor.byteLength - pullIntoDescriptor.bytesFilled);
  } catch (e) {
    DestroyReadableByteStreamController(controller);
    if (controller._ownerReadableByteStream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }
  controller._insideUnderlyingByteSource = false;

  return undefined;
}

function ReadableByteStreamControllerCallPull(controller) {
  controller._considerReissueUnderlyingByteSourcePull = false;

  controller._insideUnderlyingByteSource = true;
  try {
    controller._underlyingByteSource.pull();
  } catch (e) {
    DestoryReadableByteStreamController(controller);
    if (controller._ownerReadableByteStream._state === 'readable') {
      ErrorReadableByteStream(stream, e);
    }
  }
  controller._insideUnderlyingByteSource = false;

  return undefined;
}

function MaybeCallPullOrPullIntoRepeatedly(controller) {
  const stream = controller._controlledReadableByteStream;

  while (true) {
    if (!controller._considerReissueUnderlyingByteSourcePull) {
      return undefined;
    }

    if (controller._closeRequested) {
      return undefined;
    }
    if (stream._state !== 'readable') {
      return undefined;
    }

    const reader = stream._reader;

    if (reader === undefined) {
      return undefined;
    }

    if (IsReadableByteStreamReader(reader)) {
      if (reader._readRequests.length === 0) {
        return undefined;
      }

      ReadableByteStreamControllerCallPull(controller);
    } else {
      assert(IsReadableByteStreamByobReader(reader), 'reader must be ReadableByteStreamByobReader');

      if (reader._readIntoRequests.length === 0) {
        return undefined;
      }

      ReadableByteStreamControllerCallPullInto(controller);
    }
  }

  return undefined;
}

function PullFromReadableByteStream(stream) {
  const controller = stream._controller;

  const reader = stream._reader;

  if (reader._readRequests.length > 1) {
    return undefined;
  }

  assert(reader._readRequests.length === 1);

  if (controller._totalQueuedBytes === 0) {
    if (controller._insideUnderlyingByteSource) {
      controller._considerReissueUnderlyingByteSourcePull = true;

      return undefined;
    }

    ReadableByteStreamControllerCallPull(controller);

    MaybeCallPullOrPullIntoRepeatedly(controller);

    return undefined;
  }

  const entry = controller._queue.shift();
  controller._totalQueuedBytes -= entry.byteLength;

  const view = new Uint8Array(entry.buffer, entry.byteOffset, entry.byteLength);

  const req = reader._readRequests.shift();
  req.resolve(CreateIterResultObject(view, false));

  if (controller._totalQueuedBytes === 0 && controller._closeRequested) {
    CloseReadableByteStream(stream);
  }

  return undefined;
}

function PullFromReadableByteStreamInto(stream, view) {
  const controller = stream._controller;

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
    DestroyReadableByteStreamController(controller);
    ErrorReadableByteStream(stream, new TypeError('Unknown ArrayBufferView type'));
    return undefined;
  }

  const pullIntoDescriptor = {
    buffer: view.buffer,
    byteOffset: view.byteOffset,
    byteLength: view.byteLength,
    bytesFilled: 0,
    viewType,
    elementSize
  };

  if (controller._pendingPullIntos.length > 0) {
    // TODO: Detach pullIntoDescriptor.buffer if detachRequired is true.
    controller._pendingPullIntos.push(pullIntoDescriptor);

    return undefined;
  }

  if (controller._totalQueuedBytes === 0) {
    // TODO: Detach pullIntoDescriptor.buffer if detachRequired is true.
    controller._pendingPullIntos.push(pullIntoDescriptor);

    if (controller._insideUnderlyingByteSource) {
      controller._considerReissueUnderlyingByteSourcePull = true;

      return undefined;
    }

    ReadableByteStreamControllerCallPullInto(controller);

    MaybeCallPullOrPullIntoRepeatedly(controller);

    return undefined;
  }

  const ready = FillPendingPullFromQueue(controller, pullIntoDescriptor);

  if (ready) {
    const result = CreateArrayBufferViewFromPullIntoDescriptor(pullIntoDescriptor);
    assert(result.bytesUsed === pullIntoDescriptor.bytesFilled, 'All filled bytes must be used');
    RespondToReadableByteStreamByobReaderReadIntoRequest(stream._reader, result.view);

    return undefined;
  }

  assert(controller._totalQueuedBytes === 0, 'queue must be empty');
  assert(pullIntoDescriptor.bytesFilled > 0);
  assert(pullIntoDescriptor.bytesFilled < elementSize);

  if (!controller._closeRequested) {
    // TODO: Detach pullIntoDescriptor.buffer if detachRequired is true.
    controller._pendingPullIntos.push(pullIntoDescriptor);

    if (controller._insideUnderlyingByteSource) {
      controller._considerReissueUnderlyingByteSourcePull = true;

      return undefined;
    }

    ReadableByteStreamControllerCallPullInto(controller);

    MaybeCallPullOrPullIntoRepeatedly(controller);

    return undefined;
  }

  DestroyReadableByteStreamController(controller);
  ErrorReadableByteStream(stream, new TypeError('Insufficient bytes to fill elements in the given buffer'));

  return undefined;
}

function RespondToReadableByteStreamByobReaderReadIntoRequest(reader, chunk) {
  assert(reader._readIntoRequests.length > 0,
         'readIntoRequest must not be empty when calling RespondToReadableByteStreamByobReaderReadIntoRequest');

  const req = reader._readIntoRequests.shift();

  assert(reader._state === 'readable', 'state must be readable');

  req.resolve(CreateIterResultObject(chunk, false));

  return undefined;
}
