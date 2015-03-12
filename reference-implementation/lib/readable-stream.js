const assert = require('assert');
import { InvokeOrNoop, PromiseInvokeOrNoop, typeIsObject } from './helpers';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';

export default class ReadableStream {
  constructor(underlyingSource = {}) {
    this._underlyingSource = underlyingSource;
    this._state = 'readable';
    this._initClosedPromise();
    this._storedError = undefined;
    this._started = false;
    this._draining = false;
    this._pullScheduled = false;
    this._pullingPromise = undefined;
    this._readableStreamReader = undefined;
    this._queue = [];

    this._enqueue = CreateReadableStreamEnqueueFunction(this);
    this._close = CreateReadableStreamCloseFunction(this);
    this._error = CreateReadableStreamErrorFunction(this);

    const startResult = InvokeOrNoop(underlyingSource, 'start', [this._enqueue, this._close, this._error]);
    Promise.resolve(startResult).then(
      () => {
        this._started = true;
        CallReadableStreamPull(this);
      },
      r => this._error(r)
    );
  }

  get closed() {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.closed can only be used on a ReadableStream'));
    }

    return this._closedPromise;
  }

  cancel(reason) {
    if (!IsReadableStream(this)) {
      return Promise.reject(new TypeError('ReadableStream.prototype.cancel can only be used on a ReadableStream'));
    }

    return CancelReadableStream(this, reason);
  }

  getReader() {
    if (!IsReadableStream(this)) {
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

      source.closed.catch(abortDest);
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
        } else {
          dest.write(value);
          doPipe();
        }
      });

      // Any failures will be handled by listening to source.closed and dest.closed above.
      // TODO: handle malicious dest.write/dest.close?
    }

    function cancelSource(reason) {
      if (preventCancel === false) {
        // cancelling automatically releases the lock (and that doesn't fail, since source is then closed)
        source.cancel(reason);
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


  // Note: The resolve function and reject function are cleared when the corresponding promise is resolved or rejected.
  // This is for debugging. This makes extra resolve/reject calls for the same promise fail so that we can detect
  // unexpected extra resolve/reject calls that may be caused by bugs in the algorithm.

  _initClosedPromise() {
    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });
  }

  _resolveClosedPromise(value) {
    this._closedPromise_resolve(value);
    this._closedPromise_resolve = null;
    this._closedPromise_reject = null;
  }

  _rejectClosedPromise(reason) {
    this._closedPromise_reject(reason);
    this._closedPromise_resolve = null;
    this._closedPromise_reject = null;
  }
};

class ReadableStreamReader {
  constructor(stream) {
    if (!IsReadableStream(stream)) {
      throw new TypeError('ReadableStreamReader can only be constructed with a ReadableStream instance');
    }
    if (stream._state === 'closed') {
      throw new TypeError('The stream has already been closed, so a reader cannot be acquired');
    }
    if (stream._state === 'errored') {
      throw stream._storedError;
    }
    if (IsReadableStreamLocked(stream)) {
      throw new TypeError('This stream has already been locked for exclusive reading by another reader');
    }

    this._readRequests = [];

    this._closedPromise = new Promise((resolve, reject) => {
      this._closedPromise_resolve = resolve;
      this._closedPromise_reject = reject;
    });

    stream._readableStreamReader = this;
    this._encapsulatedReadableStream = stream;
  }

  get closed() {
    if (!IsReadableStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.closed can only be used on a ReadableStreamReader'));
    }

    return this._closedPromise;
  }

  get isActive() {
    if (!IsReadableStreamReader(this)) {
      throw new TypeError('ReadableStreamReader.prototype.isActive can only be used on a ReadableStreamReader');
    }

    return this._encapsulatedReadableStream !== undefined;
  }

  cancel(reason) {
    if (!IsReadableStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.cancel can only be used on a ReadableStreamReader'));
    }

    if (this._encapsulatedReadableStream === undefined) {
      return Promise.resolve(undefined);
    }

    return CancelReadableStream(this._encapsulatedReadableStream, reason);
  }

  read() {
    if (!IsReadableStreamReader(this)) {
      return Promise.reject(
        new TypeError('ReadableStreamReader.prototype.read can only be used on a ReadableStreamReader'));
    }

    if (this._encapsulatedReadableStream === undefined || this._encapsulatedReadableStream._state === 'closed') {
      return Promise.resolve({ value: undefined, done: true });
    }

    if (this._encapsulatedReadableStream._state === 'errored') {
      return Promise.reject(this._encapsulatedReadableStream._storedError);
    }

    if (this._encapsulatedReadableStream._queue.length > 0) {
      const chunk = DequeueValue(this._encapsulatedReadableStream._queue);

      if (this._encapsulatedReadableStream._draining === true && this._encapsulatedReadableStream._queue.length === 0) {
        CloseReadableStream(this._encapsulatedReadableStream);
      } else {
        CallReadableStreamPull(this._encapsulatedReadableStream);
      }

      return Promise.resolve({ value: chunk, done: false });
    } else {
      const readRequest = {};
      readRequest.promise = new Promise((resolve, reject) => {
        readRequest._resolve = resolve;
        readRequest._reject = reject;
      });

      this._readRequests.push(readRequest);
      return readRequest.promise;
    }
  }

  releaseLock() {
    if (!IsReadableStreamReader(this)) {
      throw new TypeError('ReadableStreamReader.prototype.releaseLock can only be used on a ReadableStreamReader');
    }

    if (this._encapsulatedReadableStream === undefined) {
      return undefined;
    }

    if (this._readRequests.length > 0) {
      throw new TypeError('Tried to release a reader lock when that reader has pending read() calls un-settled');
    }

    ReleaseReadableStreamReader(this);
  }
}

function AcquireReadableStreamReader(stream) {
  return new ReadableStreamReader(stream);
}

function CallReadableStreamPull(stream) {
  if (stream._draining === true || stream._started === false ||
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

  stream._pullingPromise = PromiseInvokeOrNoop(stream._underlyingSource, 'pull', [stream._enqueue, stream._close]);
  stream._pullingPromise.then(
    () => { stream._pullingPromise = undefined; },
    e => { stream._error(e); }
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
  stream._resolveClosedPromise(undefined);

  if (stream._readableStreamReader !== undefined) {
    ReleaseReadableStreamReader(stream._readableStreamReader);
  }

  return undefined;
}

function CreateReadableStreamCloseFunction(stream) {
  return () => {
    if (stream._state !== 'readable') {
      return;
    }

    if (stream._queue.length === 0) {
      CloseReadableStream(stream);
    } else {
      stream._draining = true;
    }
  };
}

function CreateReadableStreamEnqueueFunction(stream) {
  return chunk => {
    if (stream._state === 'errored') {
      throw stream._storedError;
    }

    if (stream._state === 'closed') {
      throw new TypeError('stream is closed');
    }

    if (stream._draining === true) {
      throw new TypeError('stream is draining');
    }

    if (stream._readableStreamReader !== undefined && stream._readableStreamReader._readRequests.length > 0) {
      const readRequest = stream._readableStreamReader._readRequests.shift();
      readRequest._resolve({ value: chunk, done: false });
    } else {
      let chunkSize = 1;

      let strategy;
      try {
        strategy = stream._underlyingSource.strategy;
      } catch (strategyE) {
        stream._error(strategyE);
        throw strategyE;
      }

      if (strategy !== undefined) {
        try {
          chunkSize = strategy.size(chunk);
        } catch (chunkSizeE) {
          stream._error(chunkSizeE);
          throw chunkSizeE;
        }
      }

      try {
        EnqueueValueWithSize(stream._queue, chunk, chunkSize);
      } catch (enqueueE) {
        stream._error(enqueueE);
        throw enqueueE;
      }
    }

    CallReadableStreamPull(stream);

    const shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);
    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  };
}

function CreateReadableStreamErrorFunction(stream) {
  return e => {
    if (stream._state !== 'readable') {
      return;
    }

    stream._state = 'errored';
    stream._storedError = e;
    stream._rejectClosedPromise(e);

    if (stream._readableStreamReader !== undefined) {
      stream._readableStreamReader._closedPromise_reject(e);

      for (const { _reject } of stream._readableStreamReader._readRequests) {
        _reject(e);
      }
      stream._readableStreamReader._readRequests = [];
    }

    stream._queue = [];
  };
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

  if (stream._readableStreamReader === undefined) {
    return false;
  }

  return true;
}

function IsReadableStreamReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_encapsulatedReadableStream')) {
    return false;
  }

  return true;
}

function ReleaseReadableStreamReader(reader) {
  assert(reader._encapsulatedReadableStream !== undefined);

  for (const { _resolve } of reader._readRequests) {
    _resolve({ value: undefined, done: true });
  }
  reader._readRequests = [];

  reader._encapsulatedReadableStream._readableStreamReader = undefined;
  reader._encapsulatedReadableStream = undefined;
  reader._closedPromise_resolve(undefined);
}

function ShouldReadableStreamApplyBackpressure(stream) {
  const queueSize = GetTotalQueueSize(stream._queue);
  let shouldApplyBackpressure = queueSize > 1;

  let strategy;
  try {
    strategy = stream._underlyingSource.strategy;
  } catch (strategyE) {
    stream._error(strategyE);
    throw strategyE;
  }

  if (strategy !== undefined) {
    try {
      shouldApplyBackpressure = Boolean(strategy.shouldApplyBackpressure(queueSize));
    } catch (shouldApplyBackpressureE) {
      stream._error(shouldApplyBackpressureE);
      throw shouldApplyBackpressureE;
    }
  }

  return shouldApplyBackpressure;
}
