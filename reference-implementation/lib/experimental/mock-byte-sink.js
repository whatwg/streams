import { ThinWritableStream } from './thin-writable-stream';
import { ThinWritableByteStream } from './thin-writable-byte-stream';

class MockFileUnderlyingSink {
  constructor(file) {
    this._file = file;
  }

  start(delegate) {
    this._delegate = delegate;

    this._delegate.markWritable();
  }

  write(value) {
    this._file._write(value);
  }

  close() {
    this._file._close();
  }

  abort(reason) {
    this._file._abort(reason);
  }

  space() {
    return 16;
  }
}

class MockFileUnderlyingSinkWithGarbage {
  constructor(file) {
    this._file = file;

    this._garbages = [];
  }

  start(delegate) {
    this._delegate = delegate;

    this._delegate.markWritable();
  }

  write(view) {
    this._file._write(view);

    this._garbages.push(view);
    this._delegate.markHasGarbage();
  }

  close() {
    this._file._close();
  }

  abort(reason) {
    this._file._abort(reason);
  }

  space() {
    return 16;
  }

  readGarbage() {
    const view = this._garbages.shift();
    if (this._garbages.length === 0) {
      this._delegate.markNoGarbage();
    }
  }
}

export class MockFile {
  constructor() {
    this._bytesRead = 0;

    this._resultPromise = new Promise((resolve, reject) => {
      this._resolveResultPromise = resolve;
      this._rejectResultPromise = reject;
    });
  }

  get result() {
    return this._resultPromise;
  }

  _write(view) {
    this._bytesRead += view.byteLength;
  }

  _close() {
    this._resolveResultPromise(this._bytesRead);
    this._resolveResultPromise = undefined;
    this._rejectResultPromise = undefined;
  }

  _abort(reason) {
    this._rejectResultPromise(reason);
    this._resolveResultPromise = undefined;
    this._rejectResultPromise = undefined;
  }

  createStream() {
    return new ThinWritableStream(new MockFileUnderlyingSink(this));
  }

  createStreamWithGarbage() {
    return new ThinWritableByteStream(new MockFileUnderlyingSinkWithGarbage(this));
  }
}
