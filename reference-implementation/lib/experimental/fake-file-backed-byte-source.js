import { ThinStreamReader } from './thin-stream-reader';
import { ThinByobByteStreamReader } from './thin-byob-byte-stream-reader';

import { fillArrayBufferView } from './thin-stream-utils';

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

    if (this._markReadable !== undefined) {
      this._markReadable();
      this._markReadable = undefined;
    }

    if (result.closed) {
      this._strategy = undefined;
      this._draining = true;
      return;
    }

    this._pull();
  }

  _pull() {
    if (this._cancelled) {
      return;
    }

    if (this._strategy.shouldApplyBackpressure === undefined ||
        this._strategy.shouldApplyBackpressure(this._queueSize)) {
      return;
    }

    if (this._fileReadPromise !== undefined) {
      return;
    }

    let size = 1024;
    if (this._strategy.space !== undefined) {
      size = this._strategy.space(this._queueSize);
    }
    if (size === 0) {
      return;
    }

    const view = new Uint8Array(size);
    this._fileReadPromise = this._readFileInto(view)
        .then(this._handleFileReadResult.bind(this))
        .catch(e => {
          if (this._markErrored !== undefined) {
            this._markErrored(e);
            this._markErrored = undefined;
          }
        });
  }

  start(markReadable, markClosed, markErrored) {
    this._markReadable = markReadable;
    this._markClosed = markClosed;
    this._markErrored = markErrored;

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

  read(markReadable, markClosed) {
    const view = this._queue.shift();
    this._queueSize -= view.byteLength;

    if (this._queue.length === 0) {
      if (this._draining) {
        markClosed();
      } else {
        this._markReadable = markReadable;
        this._markClosed = markClosed;
      }
    } else {
      markReadable();
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

class FileBackedByobUnderlyingSource {
  constructor(readFileInto) {
    this._readFileInto = readFileInto;

    this._cancelled = false;

    this._fileReadPromise = undefined;

    this._pendingRequests = [];
  }

  _clearPendingRequests() {
    while (this._pendingRequests.length > 0) {
      const entry = this._pendingRequests.shift();
      entry.done();
    }
  }

  _callReadFileInto(view, done) {
    this._fileReadPromise = this._readFileInto(view)
        .then(this._handleFileReadFulfillment.bind(this, done))
        .catch(this._handleFileReadRejection.bind(this, done));
  }

  _handleFileReadFulfillment(done, result) {
    this._fileReadPromise = undefined;

    if (this._cancelled) {
      this._clearPendingRequests();
      return;
    }

    done(result.writtenRegion.byteLength);

    if (result.closed) {
      this._close();
      this._clearPendingRequests();
    } else {
      if (this._pendingRequests.length > 0) {
        const entry = this._pendingRequests.shift();
        this._callReadFileInto(entry.view, entry.done);
      }
    }
  }

  _handleFileReadRejection(done, reason) {
    if (this._cancelled) {
      this._clearPendingRequests();
      return;
    }

    this._error(reason);
    this._clearPendingRequests();
  }

  start(close, error) {
    this._close = close;
    this._error = error;
  }

  read(view, done) {
    if (this._fileReadPromise !== undefined) {
      this._pendingRequests.push({view, done});
      return;
    }

    this._callReadFileInto(view, done);
  }

  cancel(reason) {
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

  createReader(strategy) {
    const source = new FileBackedUnderlyingSource(this._readFileInto.bind(this), strategy);
    return new ThinStreamReader(source);
  }

  createByobReader() {
    const source = new FileBackedByobUnderlyingSource(this._readFileInto.bind(this));
    return new ThinByobByteStreamReader(source);
  }
}
