'use strict';
const utils = require('../../generated/utils.js');
const { rethrowAssertionErrorRejection } = require('./miscellaneous.js');

// https://heycam.github.io/webidl/#new
// https://github.com/jsdom/webidl2js/issues/193
exports.webidlNew = (globalObject, typeName, implModule) => {
  if (globalObject[utils.ctorRegistrySymbol] === undefined) {
    throw new Error('Internal error: invalid global object');
  }

  const ctor = globalObject[utils.ctorRegistrySymbol][typeName];
  if (ctor === undefined) {
    throw new Error(`Internal error: constructor ${typeName} is not installed on the passed global object`);
  }

  const obj = Object.create(ctor.prototype);
  Object.defineProperty(obj, utils.implSymbol, {
    value: Object.create(implModule.implementation.prototype),
    configurable: true
  });
  obj[utils.implSymbol][utils.wrapperSymbol] = obj;
  return obj[utils.implSymbol];
};

const originalPromise = Promise;
const originalPromiseThen = Promise.prototype.then;
const originalPromiseResolve = Promise.resolve;
const originalPromiseReject = Promise.reject;

const promiseSideTable = new WeakMap();

// A specialization of https://heycam.github.io/webidl/#invoke-a-callback-function
// Can be replaced when https://github.com/jsdom/webidl2js/pull/123 lands.
exports.promiseInvoke = (func, args, thisArg) => {
  args = args.map(utils.tryWrapperForImpl);
  try {
    return Promise.resolve(Reflect.apply(func, thisArg, args));
  } catch (e) {
    return Promise.reject(e);
  }
};

// A specialization of https://heycam.github.io/webidl/#invoke-a-callback-function
// Can be replaced when https://github.com/jsdom/webidl2js/pull/123 lands.
exports.invoke = (func, args, thisArg) => {
  args = args.map(utils.tryWrapperForImpl);
  return Reflect.apply(func, thisArg, args);
};

// https://heycam.github.io/webidl/#a-new-promise
function newPromise() {
  // The stateIsPending tracking only works if we never resolve the promises with other promises.
  // In this spec, that happens to be true for the promises in question; they are always resolved with undefined.
  const sideData = { stateIsPending: true };
  const promise = new originalPromise((resolve, reject) => {
    sideData.resolve = resolve;
    sideData.reject = reject;
  });

  promiseSideTable.set(promise, sideData);
  return promise;
}

// https://heycam.github.io/webidl/#resolve
function resolvePromise(p, value) {
  promiseSideTable.get(p).resolve(value);
  promiseSideTable.get(p).stateIsPending = false;
}

// https://heycam.github.io/webidl/#reject
function rejectPromise(p, reason) {
  promiseSideTable.get(p).reject(reason);
  promiseSideTable.get(p).stateIsPending = false;
}

// https://heycam.github.io/webidl/#a-promise-resolved-with
function promiseResolvedWith(value) {
  // Cannot use original Promise.resolve since that will return value itself sometimes, unlike Web IDL.
  const promise = new originalPromise(resolve => resolve(value));
  promiseSideTable.set(promise, { stateIsPending: false });
  return promise;
}

// https://heycam.github.io/webidl/#a-promise-rejected-with
function promiseRejectedWith(reason) {
  const promise = originalPromiseReject.call(originalPromise, reason);
  promiseSideTable.set(promise, { stateIsPending: false });
  return promise;
}

function PerformPromiseThen(promise, onFulfilled, onRejected) {
  // There doesn't appear to be any way to correctly emulate the behaviour from JavaScript, so this is just an
  // approximation.
  return originalPromiseThen.call(promise, onFulfilled, onRejected);
}

// https://heycam.github.io/webidl/#dfn-perform-steps-once-promise-is-settled
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

function stateIsPending(promise) {
  return promiseSideTable.get(promise).stateIsPending;
}

Object.assign(exports, {
  newPromise,
  resolvePromise,
  rejectPromise,
  promiseResolvedWith,
  promiseRejectedWith,
  uponPromise,
  uponFulfillment,
  uponRejection,
  transformPromiseWith,
  setPromiseIsHandledToTrue,
  stateIsPending
});

// https://heycam.github.io/webidl/#wait-for-all
function waitForAll(promises, successSteps, failureSteps) {
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
}

// https://heycam.github.io/webidl/#waiting-for-all-promise
exports.waitForAllPromise = (promises, successSteps, failureSteps = undefined) => {
  let resolveP;
  let rejectP;
  const promise = new Promise((resolve, reject) => {
    resolveP = resolve;
    rejectP = reject;
  });
  if (failureSteps === undefined) {
    failureSteps = arg => {
      throw arg;
    };
  }
  const successStepsWrapper = results => {
    try {
      const stepsResult = successSteps(results);
      resolveP(stepsResult);
    } catch (e) {
      rejectP(e);
    }
  };
  const failureStepsWrapper = reason => {
    try {
      const stepsResult = failureSteps(reason);
      resolveP(stepsResult);
    } catch (e) {
      rejectP(e);
    }
  };
  waitForAll(promises, successStepsWrapper, failureStepsWrapper);
  return promise;
};
