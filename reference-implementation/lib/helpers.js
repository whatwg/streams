'use strict';
const assert = require('assert');
const { rethrowAssertionErrorRejection } = require('./utils.js');

const isFakeDetached = Symbol('is "detached" for our purposes');

function IsPropertyKey(argument) {
  return typeof argument === 'string' || typeof argument === 'symbol';
}

exports.typeIsObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';

exports.createDataProperty = (o, p, v) => {
  assert(exports.typeIsObject(o));
  Object.defineProperty(o, p, { value: v, writable: true, enumerable: true, configurable: true });
};

exports.createArrayFromList = elements => {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice();
};

exports.ArrayBufferCopy = (dest, destOffset, src, srcOffset, n) => {
  new Uint8Array(dest).set(new Uint8Array(src, srcOffset, n), destOffset);
};

exports.IsFiniteNonNegativeNumber = v => {
  if (exports.IsNonNegativeNumber(v) === false) {
    return false;
  }

  if (v === Infinity) {
    return false;
  }

  return true;
};

exports.IsNonNegativeNumber = v => {
  if (typeof v !== 'number') {
    return false;
  }

  if (Number.isNaN(v)) {
    return false;
  }

  if (v < 0) {
    return false;
  }

  return true;
};

function Call(F, V, args) {
  if (typeof F !== 'function') {
    throw new TypeError('Argument is not a function');
  }

  return Function.prototype.apply.call(F, V, args);
}

exports.Call = Call;

exports.CreateAlgorithmFromUnderlyingMethod = (underlyingObject, methodName, algoArgCount, extraArgs) => {
  assert(underlyingObject !== undefined);
  assert(IsPropertyKey(methodName));
  assert(algoArgCount === 0 || algoArgCount === 1);
  assert(Array.isArray(extraArgs));
  const method = underlyingObject[methodName];
  if (method !== undefined) {
    if (typeof method !== 'function') {
      throw new TypeError(`${method} is not a method`);
    }
    switch (algoArgCount) {
      case 0: {
        return () => {
          return PromiseCall(method, underlyingObject, extraArgs);
        };
      }

      case 1: {
        return arg => {
          const fullArgs = [arg].concat(extraArgs);
          return PromiseCall(method, underlyingObject, fullArgs);
        };
      }
    }
  }
  return () => promiseResolvedWith(undefined);
};

exports.InvokeOrNoop = (O, P, args) => {
  assert(O !== undefined);
  assert(IsPropertyKey(P));
  assert(Array.isArray(args));

  const method = O[P];
  if (method === undefined) {
    return undefined;
  }

  return Call(method, O, args);
};

function PromiseCall(F, V, args) {
  assert(typeof F === 'function');
  assert(V !== undefined);
  assert(Array.isArray(args));
  try {
    return promiseResolvedWith(Call(F, V, args));
  } catch (value) {
    return promiseRejectedWith(value);
  }
}

exports.PromiseCall = PromiseCall;

// Not implemented correctly
exports.TransferArrayBuffer = O => {
  assert(!exports.IsDetachedBuffer(O));
  const transferredIshVersion = O.slice();

  // This is specifically to fool tests that test "is transferred" by taking a non-zero-length
  // ArrayBuffer and checking if its byteLength starts returning 0.
  Object.defineProperty(O, 'byteLength', {
    get() {
      return 0;
    }
  });
  O[isFakeDetached] = true;

  return transferredIshVersion;
};

// Not implemented correctly
exports.IsDetachedBuffer = O => {
  return isFakeDetached in O;
};

exports.ValidateAndNormalizeHighWaterMark = highWaterMark => {
  highWaterMark = Number(highWaterMark);
  if (Number.isNaN(highWaterMark) || highWaterMark < 0) {
    throw new RangeError('highWaterMark property of a queuing strategy must be non-negative and non-NaN');
  }

  return highWaterMark;
};

exports.MakeSizeAlgorithmFromSizeFunction = size => {
  if (size === undefined) {
    return () => 1;
  }
  if (typeof size !== 'function') {
    throw new TypeError('size property of a queuing strategy must be a function');
  }
  return chunk => size(chunk);
};

const originalPromise = Promise;
const originalPromiseThen = Promise.prototype.then;
const originalPromiseResolve = Promise.resolve;
const originalPromiseReject = Promise.reject;

function newPromise(executor) {
  return new originalPromise(executor);
}

function promiseResolvedWith(value) {
  return originalPromiseResolve.call(originalPromise, value);
}

function promiseRejectedWith(reason) {
  return originalPromiseReject.call(originalPromise, reason);
}

function PerformPromiseThen(promise, onFulfilled, onRejected) {
  // There doesn't appear to be any way to correctly emulate the behaviour from JavaScript, so this is just an
  // approximation.
  return originalPromiseThen.call(promise, onFulfilled, onRejected);
}

function uponPromise(promise, onFulfilled, onRejected) {
  PerformPromiseThen(
    PerformPromiseThen(promise, onFulfilled, onRejected),
    undefined,
    rethrowAssertionErrorRejection
  );
}

function uponFulfillment(promise, onFulfilled) {
  uponPromise(promise, onFulfilled);
}

function uponRejection(promise, onRejected) {
  uponPromise(promise, undefined, onRejected);
}

function transformPromiseWith(promise, fulfillmentHandler, rejectionHandler) {
  return PerformPromiseThen(promise, fulfillmentHandler, rejectionHandler);
}

function setPromiseIsHandledToTrue(promise) {
  PerformPromiseThen(promise, undefined, rethrowAssertionErrorRejection);
}

exports.newPromise = newPromise;
exports.promiseResolvedWith = promiseResolvedWith;
exports.promiseRejectedWith = promiseRejectedWith;
exports.uponPromise = uponPromise;
exports.uponFulfillment = uponFulfillment;
exports.uponRejection = uponRejection;
exports.transformPromiseWith = transformPromiseWith;
exports.setPromiseIsHandledToTrue = setPromiseIsHandledToTrue;

exports.WaitForAll = (promises, successSteps, failureSteps) => {
  let rejected = false;
  const rejectionHandler = arg => {
    if (rejected === false) {
      rejected = true;
      failureSteps(arg);
    }
  };
  let index = 0;
  let fulfilledCount = 0;
  const total = promises.length;
  const result = new Array(total);
  if (total === 0) {
    queueMicrotask(() => successSteps(result));
    return;
  }
  for (const promise of promises) {
    const promiseIndex = index;
    const fulfillmentHandler = arg => {
      result[promiseIndex] = arg;
      ++fulfilledCount;
      if (fulfilledCount === total) {
        successSteps(result);
      }
    };
    PerformPromiseThen(promise, fulfillmentHandler, rejectionHandler);
    ++index;
  }
};

exports.WaitForAllPromise = (promises, successSteps, failureSteps = undefined) => {
  let resolvePromise;
  let rejectPromise;
  const promise = newPromise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  if (failureSteps === undefined) {
    failureSteps = arg => {
      throw arg;
    };
  }
  const successStepsWrapper = results => {
    try {
      const stepsResult = successSteps(results);
      resolvePromise(stepsResult);
    } catch (e) {
      rejectPromise(e);
    }
  };
  const failureStepsWrapper = reason => {
    try {
      const stepsResult = failureSteps(reason);
      resolvePromise(stepsResult);
    } catch (e) {
      rejectPromise(e);
    }
  };
  exports.WaitForAll(promises, successStepsWrapper, failureStepsWrapper);
  return promise;
};
