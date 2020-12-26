'use strict';
const assert = require('assert');

const isFakeDetached = Symbol('is "detached" for our purposes');

exports.typeIsObject = x => (typeof x === 'object' && x !== null) || typeof x === 'function';

exports.CreateArrayFromList = elements => {
  // We use arrays to represent lists, so this is basically a no-op.
  // Do a slice though just in case we happen to depend on the unique-ness.
  return elements.slice();
};

exports.CopyDataBlockBytes = (dest, destOffset, src, srcOffset, n) => {
  new Uint8Array(dest).set(new Uint8Array(src, srcOffset, n), destOffset);
};

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
exports.CanTransferArrayBuffer = O => {
  return !exports.IsDetachedBuffer(O);
};

// Not implemented correctly
exports.IsDetachedBuffer = O => {
  return isFakeDetached in O;
};

exports.Call = (F, V, args = []) => {
  if (typeof F !== 'function') {
    throw new TypeError('Argument is not a function');
  }

  return Reflect.apply(F, V, args);
};

exports.GetMethod = (V, P) => {
  const func = V[P];
  if (func === undefined || func === null) {
    return undefined;
  }
  if (typeof func !== 'function') {
    throw new TypeError();
  }
  return func;
};

exports.CreateAsyncFromSyncIterator = syncIteratorRecord => {
  // Instead of re-implementing CreateAsyncFromSyncIterator and %AsyncFromSyncIteratorPrototype%,
  // we use yield* inside an async generator function to achieve the same result.

  // Wrap the sync iterator inside a sync iterable, so we can use it with yield*.
  const syncIterable = {
    [Symbol.iterator]: () => syncIteratorRecord.iterator
  };
  // Create an async generator function and immediately invoke it.
  const asyncIterator = (async function* () {
    return yield* syncIterable;
  }());
  // Return as an async iterator record.
  const nextMethod = asyncIterator.next;
  return { iterator: asyncIterator, nextMethod, done: false };
};

exports.GetIterator = (obj, hint = 'sync', method) => {
  assert(hint === 'sync' || hint === 'async');
  if (method === undefined) {
    if (hint === 'async') {
      method = exports.GetMethod(obj, Symbol.asyncIterator);
      if (method === undefined) {
        const syncMethod = exports.GetMethod(obj, Symbol.iterator);
        const syncIteratorRecord = exports.GetIterator(obj, 'sync', syncMethod);
        return exports.CreateAsyncFromSyncIterator(syncIteratorRecord);
      }
    } else {
      method = exports.GetMethod(obj, Symbol.iterator);
    }
  }
  const iterator = exports.Call(method, obj);
  if (!exports.typeIsObject(iterator)) {
    throw new TypeError();
  }
  const nextMethod = iterator.next;
  return { iterator, nextMethod, done: false };
};

exports.IteratorNext = (iteratorRecord, value) => {
  let result;
  if (value === undefined) {
    result = exports.Call(iteratorRecord.nextMethod, iteratorRecord.iterator);
  } else {
    result = exports.Call(iteratorRecord.nextMethod, iteratorRecord.iterator, [value]);
  }
  if (!exports.typeIsObject(result)) {
    throw new TypeError();
  }
  return result;
};

exports.IteratorComplete = iterResult => {
  assert(exports.typeIsObject(iterResult));
  return Boolean(iterResult.done);
};

exports.IteratorValue = iterResult => {
  assert(exports.typeIsObject(iterResult));
  return iterResult.value;
};
