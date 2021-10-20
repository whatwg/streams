'use strict';
const assert = require('assert');
const { rethrowAssertionErrorRejection } = require('./miscellaneous.js');

const originalPromise = Promise;
const originalPromiseThen = Promise.prototype.then;
const originalPromiseReject = Promise.reject;

const promiseSideTable = new WeakMap();

// https://webidl.spec.whatwg.org/#a-new-promise
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

// https://webidl.spec.whatwg.org/#resolve
function resolvePromise(p, value) {
  // We intend to only resolve or reject promises that are still pending.
  // When this is not the case, it usually means there's a bug in the specification that we want to fix.
  // This assertion is NOT a normative requirement. It is part of the reference implementation only
  // to help detect bugs in the specification. Other implementors MUST NOT replicate this assertion.
  assert(stateIsPending(p) === true);
  promiseSideTable.get(p).resolve(value);
  promiseSideTable.get(p).stateIsPending = false;
}

// https://webidl.spec.whatwg.org/#reject
function rejectPromise(p, reason) {
  assert(stateIsPending(p) === true);
  promiseSideTable.get(p).reject(reason);
  promiseSideTable.get(p).stateIsPending = false;
}

// https://webidl.spec.whatwg.org/#a-promise-resolved-with
function promiseResolvedWith(value) {
  // Cannot use original Promise.resolve since that will return value itself sometimes, unlike Web IDL.
  const promise = new originalPromise(resolve => resolve(value));
  promiseSideTable.set(promise, { stateIsPending: false });
  return promise;
}

// https://webidl.spec.whatwg.org/#a-promise-rejected-with
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

// https://webidl.spec.whatwg.org/#dfn-perform-steps-once-promise-is-settled
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

// https://webidl.spec.whatwg.org/#wait-for-all
function waitForAll(promises, successSteps, failureSteps) {
  let fulfilledCount = 0;
  let rejected = false;
  const rejectionHandler = arg => {
    if (rejected === false) {
      rejected = true;
      failureSteps(arg);
    }
  };
  let index = 0;
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

// https://webidl.spec.whatwg.org/#waiting-for-all-promise
exports.waitForAllPromise = promises => {
  const promise = newPromise();
  const successSteps = results => {
    resolvePromise(promise, results);
  };
  const failureSteps = reason => {
    rejectPromise(promise, reason);
  };
  waitForAll(promises, successSteps, failureSteps);
  return promise;
};
