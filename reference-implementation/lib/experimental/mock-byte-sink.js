import { NewWritableStream } from './new-writable-stream';
import { NewWritableByteStream } from './new-writable-byte-stream';

class MockFileUnderlyingSink {
  constructor(file) {
    this._file = file;
  }

  start(delegate) {
    this._delegate = delegate;
  }

  write(value) {
    this._file._count(value.byteLength);
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

class MockFileUnderlyingSinkWithDisposal {
  constructor(file) {
    this._file = file;

    this._bytesRead = 0;

    this._resultPromise = new Promise((resolve, reject) => {
      this._resolveResultPromise = resolve;
      this._rejectResultPromise = reject;
    });

    this._disposedViews = [];
  }

  start(delegate) {
    this._delegate = delegate;

    this._delegate.markWritable();
  }

  write(view) {
    this._file._count(view.byteLength);
    this._disposedViews.push(view);
    this._delegate.markHasDisposedView();
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

  readDisposedView() {
    const view = this._disposedViews.shift();
    if (this._disposedViews.length === 0) {
      this._delegate.markNoDisposedView();
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

  _count(size) {
    this._bytesRead += size;
  }

  _close() {
    this._resolveResultPromise(this._bytesRead);
  }

  _abort(reason) {
    this._rejectResultPromise(reason);
  }

  createStream() {
    return new NewWritableStream(new MockFileUnderlyingSink(this));
  }

  createStreamWithDisposal() {
    return new NewWritableByteStream(new MockFileUnderlyingSinkWithDisposal(this));
  }
}
