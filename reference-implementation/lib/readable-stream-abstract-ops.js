var assert = require('assert');
import ExclusiveStreamReader from './exclusive-stream-reader';
import { DequeueValue, EnqueueValueWithSize, GetTotalQueueSize } from './queue-with-sizes';
import { PromiseInvokeOrNoop, typeIsObject } from './helpers';

export function AcquireExclusiveStreamReader(stream) {
  if (stream._state === 'closed') {
    throw new TypeError('The stream has already been closed, so a reader cannot be acquired.');
  }
  if (stream._state === 'errored') {
    throw stream._storedError;
  }

  return new ExclusiveStreamReader(stream);
}

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

  var shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);
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

export function CloseReadableStream(stream) {
  stream._state = 'closed';
  stream._resolveClosedPromise(undefined);

  if (stream._readableStreamReader !== undefined) {
    stream._readableStreamReader.releaseLock();
  }

  return undefined;
}

export function CreateReadableStreamCloseFunction(stream) {
  return () => {
    if (stream._state === 'waiting') {
      stream._resolveReadyPromise(undefined);
      return CloseReadableStream(stream);
    }
    if (stream._state === 'readable') {
      stream._draining = true;
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

    var chunkSize = 1;

    var strategy;
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


    var shouldApplyBackpressure = ShouldReadableStreamApplyBackpressure(stream);

    if (stream._state === 'waiting') {
      stream._state = 'readable';
      stream._resolveReadyPromise(undefined);
    }

    if (shouldApplyBackpressure === true) {
      return false;
    }
    return true;
  };
}

export function CreateReadableStreamErrorFunction(stream) {
  return e => {
    if (stream._state === 'waiting') {
      stream._resolveReadyPromise(undefined);
    }
    if (stream._state === 'readable') {
      stream._queue = [];
    }
    if (stream._state === 'waiting' || stream._state === 'readable') {
      stream._state = 'errored';
      stream._storedError = e;
      stream._rejectClosedPromise(e);
      if (stream._readableStreamReader !== undefined) {
        stream._readableStreamReader.releaseLock();
      }
    }
  };
}

export function IsExclusiveStreamReader(x) {
  if (!typeIsObject(x)) {
    return false;
  }

  if (!Object.prototype.hasOwnProperty.call(x, '_encapsulatedReadableStream')) {
    return false;
  }

  return true;
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
  if (stream._state === 'waiting') {
    throw new TypeError('no chunks available (yet)');
  }
  if (stream._state === 'closed') {
    throw new TypeError('stream has already been consumed');
  }
  if (stream._state === 'errored') {
    throw stream._storedError;
  }

  assert(stream._state === 'readable', `stream state ${stream._state} is invalid`);
  assert(stream._queue.length > 0, 'there must be chunks available to read');

  var chunk = DequeueValue(stream._queue);

  if (stream._queue.length === 0) {
    if (stream._draining === true) {
      CloseReadableStream(stream);
    } else {
      stream._state = 'waiting';
      stream._initReadyPromise();
    }
  }

  CallReadableStreamPull(stream);

  return chunk;
}

export function ShouldReadableStreamApplyBackpressure(stream) {
  var queueSize = GetTotalQueueSize(stream._queue);
  var shouldApplyBackpressure = queueSize > 1;

  var strategy;
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
