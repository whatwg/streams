const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, ValidateAndNormalizeQueuingStrategy } from './helpers';
import { createArrayFromList, createDataProperty, typeIsObject } from './helpers';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';

export default class ReadableStream {
  constructor(underlyingSource = {}) {
    this._underlyingSource = underlyingSource;
    this._queue = [];
    this._state = 'readable';
    this._started = false;
    this._closeRequested = false;
    this._pullScheduled = false;
    this._reader = undefined;
    this._pullingPromise = undefined;
    this._storedError = undefined;

    const strategy = underlyingSource.strategy;
    const normalizedStrategy = ValidateAndNormalizeQueuingStrategy(strategy, 1);
    this._strategySize = normalizedStrategy.size;
    this._strategyHWM = normalizedStrategy.highWaterMark;

    this._controller = new ReadableStreamController(this);

    const startResult = InvokeOrNoop(underlyingSource, 'start', [this._controller]);
    Promise.resolve(startResult).then(
      () => {
        this._started = true;
        CallReadableStreamPull(this);
      },
      r => ErrorReadableStream(this, r)
    );
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
          dest.write(value);
          doPipe();
        }
      });

      // Any failures will be handled by listening to reader.closed and dest.closed above.
      // TODO: handle malicious dest.write/dest.close?
    }

    function cancelSource(reason) {
      if (preventCancel === false) {
        // cancelling automatically releases the lock (and that doesn't fail, since source is then closed)
        reader.cancel(reason);
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
  constructor(stream) {
    if (IsReadableStream(stream) === false) {
      throw new TypeError('ReadableStreamController can only be constructed with a ReadableStream instance');
    }

    if (stream._controller !== undefined) {
      throw new TypeError('ReadableStreamController instances can only be created by the ReadableStream constructor');
    }

    this._controlledReadableStream = stream;
  }

  get desiredSize() {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError(
        'ReadableStreamController.prototype.desiredSize can only be used on a ReadableStreamController');
    }

    return GetReadableStreamDesiredSize(this._controlledReadableStream);
  }

  close() {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.close can only be used on a ReadableStreamController');
    }

    const stream = this._controlledReadableStream;

    if (stream._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }
    if (stream._state === 'errored') {
      throw new TypeError('The stream is in an errored state and cannot be closed');
    }

    return CloseReadableStream(stream);
  }

  enqueue(chunk) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.enqueue can only be used on a ReadableStreamController');
    }

    const stream = this._controlledReadableStream;

    if (stream._state === 'errored') {
      throw stream._storedError;
    }

    if (stream._state === 'closed') {
      throw new TypeError('stream is closed');
    }

    if (stream._closeRequested === true) {
      throw new TypeError('stream is draining');
    }

    return EnqueueInReadableStream(stream, chunk);
  }

  error(e) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.error can only be used on a ReadableStreamController');
    }

    if (this._controlledReadableStream._state !== 'readable') {
      throw new TypeError(`The stream is ${this._controlledReadableStream._state} and so cannot be errored`);
    }

    return ErrorReadableStream(this._controlledReadableStream, e);
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

    stream._reader = this;
    this._ownerReadableStream = stream;
    this._state = 'readable';
    this._storedError = undefined;

    this._readRequests = [];

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    if (stream._state === 'closed' || stream._state === 'errored') {
      ReleaseReadableStreamReader(this);
    }
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

    if (this._state === 'closed') {
      return Promise.resolve(undefined);
    }

    if (this._state === 'errored') {
      return Promise.reject(this._storedError);
    }

    assert(this._ownerReadableStream !== undefined);
    assert(this._ownerReadableStream._state === 'readable');

    return CancelReadableStream(this._ownerReadableStream, reason);
  }

  read() {
    if (IsReadableStreamReader(this) === false) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.read can only be used on a ReadableStreamReader'));
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

    return ReleaseReadableStreamReader(this);
  }
}


function AcquireReadableStreamReader(stream) {
  return new ReadableStreamReader(stream);
}

function CallReadableStreamPull(stream) {
  if (stream._closeRequested === true || stream._started === false ||
      stream._state === 'closed' || stream._state === 'errored' ||
      stream._pullScheduled === true) {
    return undefined;
  }

  if (stream._pullingPromise !== undefined) {
    stream._pullScheduled = true;
    stream._pullingPromise.then(() => {
      stream._pullScheduled = false;
      CallReadableStreamPull(stream);
    });
    return undefined;
  }

  if (IsReadableStreamLocked(stream) === false || stream._reader._readRequests.length === 0) {
    const desiredSize = GetReadableStreamDesiredSize(stream);
    if (desiredSize <= 0) {
      return undefined;
    }
  }

  stream._pullingPromise = PromiseInvokeOrNoop(stream._underlyingSource, 'pull', [stream._controller]);
  stream._pullingPromise.then(
    () => { stream._pullingPromise = undefined; },
    e => ErrorReadableStream(stream, e)
  );

  return undefined;
}

function CancelReadableStream(stream, reason) {
  if (stream._state === 'closed') {
    return Promise.resolve(undefined);
  }
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  stream._queue = [];
  FinishClosingReadableStream(stream);

  const sourceCancelPromise = PromiseInvokeOrNoop(stream._underlyingSource, 'cancel', [reason]);
  return sourceCancelPromise.then(() => undefined);
}

function CloseReadableStream(stream) {
  assert(stream._closeRequested === false);
  assert(stream._state !== 'errored');

  if (stream._state === 'closed') {
    // This will happen if the stream was closed without calling its controller's close() method, i.e. if it was closed
    // via cancellation.
    return undefined;
  }

  stream._closeRequested = true;

  if (stream._queue.length === 0) {
    return FinishClosingReadableStream(stream);
  }
}

function EnqueueInReadableStream(stream, chunk) {
  assert(stream._state === 'readable');
  assert(stream._closeRequested === false);

  if (IsReadableStreamLocked(stream) === true && stream._reader._readRequests.length > 0) {
    const readRequest = stream._reader._readRequests.shift();
    readRequest._resolve(CreateIterResultObject(chunk, false));
  } else {
    let chunkSize = 1;

    if (stream._strategySize !== undefined) {
      try {
        chunkSize = stream._strategySize(chunk);
      } catch (chunkSizeE) {
        ErrorReadableStream(stream, chunkSizeE);
        throw chunkSizeE;
      }
    }

    try {
      EnqueueValueWithSize(stream._queue, chunk, chunkSize);
    } catch (enqueueE) {
      ErrorReadableStream(stream, enqueueE);
      throw enqueueE;
    }
  }

  CallReadableStreamPull(stream);

  return undefined;
}

function ErrorReadableStream(stream, e) {
  assert(stream._state === 'readable');

  stream._queue = [];
  stream._storedError = e;
  stream._state = 'errored';

  if (IsReadableStreamLocked(stream) === true) {
    return ReleaseReadableStreamReader(stream._reader);
  }
}

function FinishClosingReadableStream(stream) {
  assert(stream._state === 'readable');

  stream._state = 'closed';

  if (IsReadableStreamLocked(stream) === true) {
    return ReleaseReadableStreamReader(stream._reader);
  }

  return undefined;
}

function GetReadableStreamDesiredSize(stream) {
  const queueSize = GetTotalQueueSize(stream._queue);
  return stream._strategyHWM - queueSize;
}

function IsReadableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingSource')) {
    return false;
  }

  return true;
}

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

  if (!Object.prototype.hasOwnProperty.call(x, '_ownerReadableStream')) {
    return false;
  }

  return true;
}

function ReadFromReadableStreamReader(reader) {
  if (reader._state === 'closed') {
    return Promise.resolve(CreateIterResultObject(undefined, true));
  }

  if (reader._state === 'errored') {
    return Promise.reject(reader._storedError);
  }

  assert(reader._ownerReadableStream !== undefined);
  assert(reader._ownerReadableStream._state === 'readable');

  if (reader._ownerReadableStream._queue.length > 0) {
    const chunk = DequeueValue(reader._ownerReadableStream._queue);

    if (reader._ownerReadableStream._closeRequested === true && reader._ownerReadableStream._queue.length === 0) {
      FinishClosingReadableStream(reader._ownerReadableStream);
    } else {
      CallReadableStreamPull(reader._ownerReadableStream);
    }

    return Promise.resolve(CreateIterResultObject(chunk, false));
  } else {
    const readRequest = {};
    readRequest.promise = new Promise((resolve, reject) => {
      readRequest._resolve = resolve;
      readRequest._reject = reject;
    });

    reader._readRequests.push(readRequest);
    return readRequest.promise;
  }
}

function ReleaseReadableStreamReader(reader) {
  assert(reader._ownerReadableStream !== undefined);

  if (reader._ownerReadableStream._state === 'errored') {
    reader._state = 'errored';

    const e = reader._ownerReadableStream._storedError;
    reader._storedError = e;
    reader._closedPromise_reject(e);

    for (const { _reject } of reader._readRequests) {
      _reject(e);
    }
  } else {
    reader._state = 'closed';
    reader._closedPromise_resolve(undefined);

    for (const { _resolve } of reader._readRequests) {
      _resolve(CreateIterResultObject(undefined, true));
    }
  }

  reader._readRequests = [];
  reader._ownerReadableStream._reader = undefined;
  reader._ownerReadableStream = undefined;
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
  const branch1 = new ReadableStream(underlyingSource1);

  const underlyingSource2 = Object.create(Object.prototype);
  createDataProperty(underlyingSource2, 'pull', pull);
  createDataProperty(underlyingSource2, 'cancel', cancel2);
  const branch2 = new ReadableStream(underlyingSource2);

  pull._branch1 = branch1;
  pull._branch2 = branch2;

  reader._closedPromise.catch(r => {
    if (teeState.closedOrErrored === true) {
      return undefined;
    }

    ErrorReadableStream(branch1, r);
    ErrorReadableStream(branch2, r);
    teeState.closedOrErrored = true;
  });

  return [branch1, branch2];
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
        CloseReadableStream(branch1);
        CloseReadableStream(branch2);
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
        EnqueueInReadableStream(branch1, value1);
      }

      if (teeState.canceled2 === false) {
        let value2 = value;
//        if (shouldClone === true) {
//          value2 = StructuredClone(value);
//        }
        EnqueueInReadableStream(branch2, value2);
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
