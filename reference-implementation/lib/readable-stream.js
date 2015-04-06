const assert = require('assert');
import { CreateIterResultObject, InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } from './helpers';
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
      throw new TypeError('ReadableStream.prototype.getReader can only be used on a ReadableStream');
    }

    return TeeReadableStream(this, false);
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

  close() {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.close can only be used on a ReadableStreamController');
    }

    if (this._controlledReadableStream._closeRequested === true) {
      throw new TypeError('The stream has already been closed; do not close it again!');
    }
    if (this._controlledReadableStream._state === 'errored') {
      throw new TypeError('The stream is in an errored state and cannot be closed');
    }

    if (this._controlledReadableStream._state === 'closed') {
      // This will happen if the stream was closed without close() being called, i.e. by a call to stream.cancel()
      return undefined;
    }

    this._controlledReadableStream._closeRequested = true;

    if (this._controlledReadableStream._queue.length === 0) {
      return CloseReadableStream(this._controlledReadableStream);
    }
  }

  enqueue(chunk) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.enqueue can only be used on a ReadableStreamController');
    }

    if (this._controlledReadableStream._state === 'errored') {
      throw this._controlledReadableStream._storedError;
    }

    if (this._controlledReadableStream._state === 'closed') {
      throw new TypeError('stream is closed');
    }

    if (this._controlledReadableStream._closeRequested === true) {
      throw new TypeError('stream is draining');
    }

    if (IsReadableStreamLocked(this._controlledReadableStream) === true &&
        this._controlledReadableStream._reader._readRequests.length > 0) {
      const readRequest = this._controlledReadableStream._reader._readRequests.shift();
      readRequest._resolve(CreateIterResultObject(chunk, false));
    } else {
      let chunkSize = 1;

      let strategy;
      try {
        strategy = this._controlledReadableStream._underlyingSource.strategy;
      } catch (strategyE) {
        ErrorReadableStream(this._controlledReadableStream, strategyE);
        throw strategyE;
      }

      if (strategy !== undefined) {
        try {
          chunkSize = strategy.size(chunk);
        } catch (chunkSizeE) {
          ErrorReadableStream(this._controlledReadableStream, chunkSizeE);
          throw chunkSizeE;
        }
      }

      try {
        EnqueueValueWithSize(this._controlledReadableStream._queue, chunk, chunkSize);
      } catch (enqueueE) {
        ErrorReadableStream(this._controlledReadableStream, enqueueE);
        throw enqueueE;
      }
    }

    CallReadableStreamPull(this._controlledReadableStream);

    const shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(this._controlledReadableStream);
    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  }

  error(e) {
    if (IsReadableStreamController(this) === false) {
      throw new TypeError('ReadableStreamController.prototype.error can only be used on a ReadableStreamController');
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

  const shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);
  if (shouldApplyBackpressure === true) {
    return undefined;
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
  CloseReadableStream(stream);

  const sourceCancelPromise = PromiseInvokeOrNoop(stream._underlyingSource, 'cancel', [reason]);
  return sourceCancelPromise.then(() => undefined);
}

function CloseReadableStream(stream) {
  assert(stream._state === 'readable');

  stream._state = 'closed';

  if (IsReadableStreamLocked(stream) === true) {
    return ReleaseReadableStreamReader(stream._reader);
  }

  return undefined;
}

function ErrorReadableStream(stream, e) {
  if (stream._state !== 'readable') {
    throw new TypeError(`The stream is ${stream._state} and so cannot be errored`);
  }

  stream._queue = [];
  stream._storedError = e;
  stream._state = 'errored';

  if (IsReadableStreamLocked(stream) === true) {
    return ReleaseReadableStreamReader(stream._reader);
  }
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
      CloseReadableStream(reader._ownerReadableStream);
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

function ShouldReadableStreamApplyBackpressure(stream) {
  const queueSize = GetTotalQueueSize(stream._queue);
  let shouldApplyBackpressure = queueSize > 1;

  let strategy;
  try {
    strategy = stream._underlyingSource.strategy;
  } catch (strategyE) {
    ErrorReadableStream(stream, strategyE);
    throw strategyE;
  }

  if (strategy !== undefined) {
    try {
      shouldApplyBackpressure = Boolean(strategy.shouldApplyBackpressure(queueSize));
    } catch (shouldApplyBackpressureE) {
      ErrorReadableStream(stream, shouldApplyBackpressureE);
      throw shouldApplyBackpressureE;
    }
  }

  return shouldApplyBackpressure;
}

function TeeReadableStream(stream, clone) {
  assert(IsReadableStream(stream) === true);
  const reader = AcquireReadableStreamReader(stream);

  let canceled1 = false;
  let cancelReason1 = undefined;
  let canceled2 = false;
  let cancelReason2 = undefined;
  let closedOrErrored = false;

  let cancelPromise_resolve;
  const cancelPromise = new Promise((resolve, reject) => {
    cancelPromise_resolve = resolve;
  });

  const branch1 = new ReadableStream({
    pull: readAndEnqueueInBoth,
    cancel(reason) {
      canceled1 = true;
      cancelReason1 = reason;
      maybeCancelSource();
      return cancelPromise;
    }
  });

  const branch2 = new ReadableStream({
    pull: readAndEnqueueInBoth,
    cancel(reason) {
      canceled2 = true;
      cancelReason2 = reason;
      maybeCancelSource();
      return cancelPromise;
    }
  });

  reader._closedPromise.catch(e => {
    if (!closedOrErrored) {
      branch1._error(e);
      branch2._error(e);
      closedOrErrored = true;
    }
  });

  return [branch1, branch2];

  function readAndEnqueueInBoth() {
    ReadFromReadableStreamReader(reader).then(({ value, done }) => {
      if (done && !closedOrErrored) {
        branch1._close();
        branch2._close();
        closedOrErrored = true;
      }

      if (closedOrErrored) {
        return;
      }

      let value1 = value;
      let value2 = value;
      if (clone) {
        value1 = StructuredClone(value);
        value2 = StructuredClone(value);
      }

      if (canceled1 === false) {
        branch1._enqueue(value1);
      }
      if (canceled2 === false) {
        branch2._enqueue(value2);
      }
    });
  }

  function maybeCancelSource() {
    if (canceled1 === true && canceled2 === true) {
      cancelPromise_resolve(CancelReadableStream(stream, [cancelReason1, cancelReason2]));
    }
  }
}
