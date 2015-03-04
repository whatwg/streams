export function writableAcceptsWriteAndClose(state) {
  return state === 'waiting' || state === 'writable';
}

export function writableAcceptsAbort(state) {
  return state === 'waiting' || state === 'writable' || state === 'closed';
}

export function readableAcceptsCancel(state) {
  return state === 'waiting' || state === 'readable';
}

// Exported as a helper for building transformation.
export function selectStreams(readable, writable) {
  const promises = [];

  promises.push(readable.errored);
  if (readable.state === 'waiting') {
    promises.push(readable.ready);
  }

  promises.push(writable.errored);
  if (writable.state === 'writable') {
    promises.push(writable.waitSpaceChange());
  } else if (writable.state === 'waiting') {
    promises.push(writable.ready);
  }

  return Promise.race(promises);
}

// Pipes data from source to dest with no transformation. Abort signal, cancel signal and space are also propagated
// between source and dest.
export function pipeStreams(source, dest) {
  return new Promise((resolve, reject) => {
    const oldWindow = source.window;

    function disposeStreams(error) {
      if (writableAcceptsAbort(dest.state)) {
        dest.abort(error);
      }
      if (readableAcceptsCancel(source.state)) {
        source.abort(error);
      }
      reject(error);
    }

    function loop() {
      for (;;) {
        if (source.state === 'errored') {
          if (writableAcceptsAbort(dest.state)) {
            dest.abort(source.error);
          }
          reject(new TypeError('source is errored'));
          return;
        }

        if (dest.state === 'errored') {
          if (readableAcceptsCancel(source.state)) {
            source.cancel(dest.error);
          }
          reject(new TypeError('dest is errored'));
          return;
        }

        if (source.state === 'closed') {
          dest.close();
          resolve();
          return;
        }

        if (source.state === 'readable') {
          if (dest.state === 'writable') {
            dest.write(source.read());
            continue;
          }
        } else {
          source.window = dest.space;
        }

        selectStreams(source, dest)
            .then(loop)
            .catch(disposeStreams);
        return;
      }
    }
    loop();
  });
}
