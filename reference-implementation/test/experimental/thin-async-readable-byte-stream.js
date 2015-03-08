const test = require('tape-catch');

import { fillArrayBufferView } from '../../lib/experimental/thin-stream-utils';
import { ThinAsyncReadableByteStream } from '../../lib/experimental/thin-async-readable-byte-stream';

test('Construct a ThinAsyncReadableByteStream', t => {
  class Source {
    constructor(size) {
      this._bytesRemaining = size;
    }

    start(delegate) {
      this._delegate = delegate;
    }

    read(container) {
      if (this._bytesRemaining === 0) {
        this._delegate.close();
        return;
      }

      const bytesToFill = Math.min(this._bytesRemaining, container.byteLength);
      fillArrayBufferView(container, 1, bytesToFill);
      this._bytesRemaining -= bytesToFill;
      this._delegate.fulfill(container.subarray(0, bytesToFill));
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  let bytesRead = 0;

  const buffer = new Uint8Array(16);

  const rs = new ThinAsyncReadableByteStream(new Source(1024));
  function pump() {
    fillArrayBufferView(buffer, 0);
    rs.read(buffer).then(result => {
      if (result.done) {
        t.equal(bytesRead, 1024);
        t.end();
      } else {
        const view = result.value;
        for (let i = 0; i < view.byteLength; ++i) {
          if (view[i] !== 1) {
            t.fail('view[' + i + '] is ' + view[i]);
            t.end();
            return;
          }
        }
        bytesRead += view.byteLength;
        pump();
      }
    }, reason => {
      t.fail(reason);
      t.end();
    }).catch(e => {
      t.fail(e);
      t.end();
    });
  }
  pump();
});

test('read() on a closed stream', t => {
  class Source {
    start(delegate) {
      delegate.close();
    }

    read() {
      t.fail('read() is called');
      t.end();
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const rs = new ThinAsyncReadableByteStream(new Source());

  rs.read(new Uint8Array(16)).then(result => {
    t.equal(result.done, true);
    t.equal(result.container.byteLength, 16);

    rs.read(new Uint8Array(16)).then(result => {
      t.equal(result.done, true);
      t.equal(result.container.byteLength, 16);
      t.end();
    });
  });
});

test('Close a stream with pending read()s', t => {
  let readCount = 0;

  let delegate = undefined;
  class Source {
    start(delegate_) {
      delegate = delegate_;
    }

    read(container) {
      t.equal(container.byteLength, 16);
      ++readCount;
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const rs = new ThinAsyncReadableByteStream(new Source());

  let firstReadFulfilled = false;
  rs.read(new Uint8Array(16)).then(result => {
    t.equal(result.done, true);
    t.equal(result.container.byteLength, 16);
    firstReadFulfilled = true;
  });
  rs.read(new Uint8Array(16)).then(result => {
    t.equal(result.done, true);
    t.equal(result.container.byteLength, 16);
    t.equal(firstReadFulfilled, true);
    t.equal(readCount, 2);
    t.end();
  });

  delegate.close();
});

test('read() on a errored stream', t => {
  const testError = new TypeError('test');

  class Source {
    start(delegate) {
      delegate.error(testError);
    }

    read() {
      t.fail('read() is called');
      t.end();
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const rs = new ThinAsyncReadableByteStream(new Source());

  rs.read(new Uint8Array(16)).catch(e => {
    t.equal(e.value, testError);
    t.equal(e.container.byteLength, 16);

    rs.read(new Uint8Array(16)).catch(e => {
      t.equal(e.value, testError);
      t.equal(e.container.byteLength, 16);
      t.end();
    });
  });
});

test('Error a stream with pending read()s', t => {
  let readCount = 0;

  let delegate = undefined;
  class Source {
    start(delegate_) {
      delegate = delegate_;
    }

    read(container) {
      t.equal(container.byteLength, 16);
      ++readCount;
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const testError = new TypeError('test');

  const rs = new ThinAsyncReadableByteStream(new Source());

  let firstReadRejected = false;
  rs.read(new Uint8Array(16)).catch(e => {
    t.equal(e.value, testError);
    t.equal(e.container.byteLength, 16);
    firstReadRejected = true;
  });
  rs.read(new Uint8Array(16)).catch(e => {
    t.equal(e.value, testError);
    t.equal(e.container.byteLength, 16);
    t.equal(firstReadRejected, true);
    t.equal(readCount, 2);
    t.end();
  });

  delegate.error(testError);
});
