export function writableAcceptsWriteAndClose(state) {
  return state === 'waiting' || state === 'writable';
}

export function writableAcceptsAbort(state) {
  return state === 'waiting' || state === 'writable' || state === 'closed';
}

export function readableAcceptsReadAndCancel(state) {
  return state === 'waiting' || state === 'readable';
}

// Exported as a helper for building transformation.
export function selectStreams(readable, writable) {
  const promises = [];

  promises.push(readable.errored);
  if (readable.state === 'waiting') {
    promises.push(readable.readable);
  }

  promises.push(writable.errored);
  if (writable.state === 'writable') {
    promises.push(writable.waitSpaceChange());
  } else if (writable.state === 'waiting') {
    promises.push(writable.writable);
  }

  return Promise.race(promises);
}
