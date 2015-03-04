import { NewReadableStream } from './new-readable-stream';
import { NewReadableByteStream } from './new-readable-byte-stream';

import { fillArrayBufferView } from './new-stream-utils';

class FileBackedUnderlyingSource {
  constructor(readFileInto, strategy) {
    this._readFileInto = readFileInto;

    this._strategy = strategy;

    this._queue = [];
    this._queueSize = 0;

    this._draining = false;

    this._cancelled = false;

    this._fileReadPromise = undefined;
  }

  _handleFileReadResult(result) {
    if (this._cancelled) {
      return;
    }

    this._fileReadPromise = undefined;

    this._queue.push(result.writtenRegion);
    this._queueSize += result.writtenRegion.byteLength;

    console.log('queue' + this._queueSize);

    this._delegate.markReadable();

    if (result.closed) {
      this._strategy = undefined;
      this._draining = true;
      return;
    }

    this._pull();
  }

  _pull() {
    console.log('222');

    if (this._cancelled) {
      return;
    }

    console.log('223');

    if (this._strategy.shouldApplyBackpressure === undefined ||
        this._strategy.shouldApplyBackpressure(this._queueSize)) {
      return;
    }

    console.log('224');

    if (this._fileReadPromise !== undefined) {
      return;
    }

    let size = 1024;
    if (this._strategy.space !== undefined) {
      size = this._strategy.space(this._queueSize);
    }
    if (size === 0) {
      console.log('full');
      return;
    }
    console.log('ssss' + size);

    const view = new Uint8Array(size);
    this._fileReadPromise = this._readFileInto(view)
        .then(this._handleFileReadResult.bind(this))
        .catch(this._delegate.markErrored.bind(this._delegate));
  }

  start(delegate) {
    this._delegate = delegate;

    this._pull();
  }

  onWindowUpdate(v) {
    if (this._strategy === undefined) {
      return;
    }

    if (this._strategy.onWindowUpdate !== undefined) {
      this._strategy.onWindowUpdate(v);
    }

    this._pull();
  }

  read() {
    const view = this._queue.shift();
    this._queueSize -= view.byteLength;

    if (this._queue.length === 0) {
      if (this._draining) {
        this._delegate.markClosed();
      } else {
        this._delegate.markWaiting();
      }
    }

    if (!this._draining) {
      this._pull();
    }

    return view;
  }

  cancel() {
    this._queue = [];

    this._cancelled = true;
  }
}

class FileBackedManualPullUnderlyingSource {
  constructor(readFileInto) {
    this._readFileInto = readFileInto;

    this._currentResult = undefined;

    this._draining = false;

    this._cancelled = false;

    this._fileReadPromise = undefined;
  }

  _handleFileReadResult(result) {
    if (this._cancelled) {
      return;
    }

    this._fileReadPromise = undefined;
    this._delegate.markPullable();

    this._currentResult = result.writtenRegion;
    this._delegate.markReadable();

    if (result.closed) {
      this._draining = true;
    }
  }

  start(delegate) {
    this._delegate = delegate;

    this._delegate.markPullable();
  }

  pull(view) {
    this._fileReadPromise = this._readFileInto(view)
        .then(this._handleFileReadResult.bind(this))
        .catch(this._delegate.markErrored.bind(this._delegate));

    this._delegate.markNotPullable();
  }

  read() {
    if (this._draining) {
      this._delegate.markClosed();
    } else {
      this._delegate.markWaiting();
    }

    const result = this._currentResult;
    this._currentResult = undefined;
    return result;
  }

  cancel() {
    this._cancelled = true;
  }
}

export class FakeFile {
  constructor(size) {
    this._bytesRemaining = size;
  }

  _readFileInto(view) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const bytesToWrite = Math.min(this._bytesRemaining, view.byteLength);

          fillArrayBufferView(view, 1, bytesToWrite);

          this._bytesRemaining -= bytesToWrite;

          const writtenRegion = view.subarray(0, bytesToWrite);
          console.log('zzzz ' + writtenRegion.byteLength);
          if (this._bytesRemaining === 0) {
            resolve({closed: true, writtenRegion});
          } else {
            resolve({closed: false, writtenRegion});
          }
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }

  createStream(strategy) {
    return new NewReadableStream(new FileBackedUnderlyingSource(this._readFileInto.bind(this), strategy));
  }

  // Returns a manual pull readable stream.
  //
  // Example semantics:
  //
  // POSIX socket:
  // - The stream becomes pullable when epoll(7) returns, and stays to be pullable until read(2) returns EAGAIN.
  //
  // Blocking or async I/O interfaces which takes a buffer on reading function call:
  // - The stream is always pullable.
  createManualPullStream() {
      return new NewReadableByteStream(new FileBackedManualPullUnderlyingSource(this._readFileInto.bind(this)));
  }
}
