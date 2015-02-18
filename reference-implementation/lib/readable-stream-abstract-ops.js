const assert = require('assert');
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';
import { PromiseInvokeOrNoop, typeIsObject } from './helpers';

export const ReadableStreamEOS = Symbol('ReadableStream.EOS');

export function CallReadableStreamPull(stream) {
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

export function CancelReadableStream(stream, reason) {
  if (stream._state === 'closed' || stream._state === 'errored') {
    return stream._closedPromise;
  }

  stream._queue = [];
  CloseReadableStream(stream);

  const sourceCancelPromise = PromiseInvokeOrNoop(stream._underlyingSource, 'cancel', [reason]);
  return sourceCancelPromise.then(() => undefined);
}

function CloseReadableStream(stream) {
  stream._readyPromise_resolve(undefined);
  stream._resolveClosedPromise(undefined);

  stream._state = 'closed';

  return undefined;
}

export function CreateReadableStreamCloseFunction(stream) {
  return () => {
    if (stream._state === 'readable') {
      // TODO: refactor draining to a 'close' readRecord, like WritableStream uses!?
      if (stream._queue.length === 0) {
        CloseReadableStream(stream);
      } else {
        stream._draining = true;
      }
    }
  };
}

export function CreateReadableStreamEnqueueFunction(stream) {
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

    const queueWasEmpty = stream._queue.length === 0;
    try {
      EnqueueValueWithSize(stream._queue, chunk, chunkSize);
    } catch (enqueueE) {
      stream._error(enqueueE);
      throw enqueueE;
    }


    const shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);

    if (queueWasEmpty) {
      stream._readyPromise_resolve(undefined);
    }

    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  };
}

export function CreateReadableStreamErrorFunction(stream) {
  return e => {
    if (stream._state === 'closed' || stream._state === 'errored') {
      return;
    }

    assert(stream._state === 'readable', `stream state ${stream._state} is invalid`);

    stream._queue = [];
    stream._readyPromise_resolve(undefined);
    stream._rejectClosedPromise(e);

    stream._storedError = e;
    stream._state = 'errored';

    return undefined;
  };
}

export function IsReadableStream(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_underlyingSource')) {
    return false;
  }

  return true;
}

export function ReadFromReadableStream(stream) {
  if (stream._state === 'errored') {
    return Promise.reject(stream._storedError);
  }

  if (stream._state === 'closed') {
    return Promise.resolve(ReadableStreamEOS);
  }

  assert(stream._state === 'readable', `stream state ${stream._state} is invalid`);

  stream._reading = true;

  if (stream._queue.length > 0) {
    const chunk = DequeueValue(stream._queue);

    if (stream._queue.length === 0) {
      if (stream._draining === true) {
        CloseReadableStream(stream);
      } else {
        stream._initReadyPromise();
      }
    }

    CallReadableStreamPull(stream);
    const chunkPromise = Promise.resolve(chunk);
    chunkPromise.then(() => {
      stream._reading = false;
    });
    return chunkPromise;
  }

  // assert: stream._readyPromise is not fulfilled

  return stream._readyPromise.then(() => ReadFromReadableStream(stream));
}

export function ShouldReadableStreamApplyBackpressure(stream) {
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
