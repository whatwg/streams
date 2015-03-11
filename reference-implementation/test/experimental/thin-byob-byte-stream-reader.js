const test = require('tape-catch');

import { fillArrayBufferView } from '../../lib/experimental/thin-stream-utils';
import { ThinByobByteStreamReader } from '../../lib/experimental/thin-byob-byte-stream-reader';

test('Construct a ThinByobByteStreamReader', t => {
  class Source {
    constructor(size) {
      this._bytesRemaining = size;
    }

    read(view, done, close) {
      if (this._bytesRemaining === 0) {
        close();
        // Call done() only to return the buffer.
        done();
        return;
      }

      const bytesToFill = Math.min(this._bytesRemaining, view.byteLength);
      fillArrayBufferView(view, 1, bytesToFill);
      this._bytesRemaining -= bytesToFill;
      done(bytesToFill);
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  let bytesRead = 0;

  const buffer = new Uint8Array(16);

  const rs = new ThinByobByteStreamReader(new Source(1024));
  function pump() {
    fillArrayBufferView(buffer, 0);
    rs.read(buffer).then(({value, done}) => {
      if (done) {
        t.equal(bytesRead, 1024);
        t.end();
        return;
      } else {
        for (let i = 0; i < value.byteLength; ++i) {
          if (value[i] !== 1) {
            t.fail('value[' + i + '] is ' + value[i]);
            t.end();
            return;
          }
        }
        bytesRead += value.byteLength;
        pump();
      }
    }, e => {
      t.fail(e);
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
    start(close) {
      close();
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

  const rs = new ThinByobByteStreamReader(new Source());

  rs.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);
    t.equal(value.byteLength, 16);

    rs.read(new Uint8Array(16)).then(({value, done}) => {
      t.equal(done, true);
      t.equal(value.byteLength, 16);
      t.end();
    });
  });
});

test('Close a stream with pending read()s', t => {
  let readCount = 0;

  let close = undefined;
  let done = undefined;
  class Source {
    start(close_) {
      close = close_;
    }

    read(view, done_) {
      t.equal(view.byteLength, 16);
      ++readCount;

      done = done_;
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const rs = new ThinByobByteStreamReader(new Source());

  let firstReadFulfilled = false;
  rs.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);
    t.equal(value.byteLength, 16);
    firstReadFulfilled = true;
  }).catch(e => {
    t.fail(e);
    t.end();
  });
  rs.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);
    t.equal(value.byteLength, 16);
    t.equal(firstReadFulfilled, true);
    t.equal(readCount, 2);
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });

  close();
  // Return the buffers.
  done();
  done();
});

test('read() on a errored stream', t => {
  const testError = new TypeError('test');

  class Source {
    start(close, error) {
      error(testError);
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

  const rs = new ThinByobByteStreamReader(new Source());

  rs.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);
    t.equal(view.byteLength, 0);
    t.equal(view.buffer.byteLength, 16);

    rs.read(new Uint8Array(16)).catch(({reason, view}) => {
      t.equal(reason, testError);
      t.equal(view.byteLength, 0);
      t.equal(view.buffer.byteLength, 16);
      t.end();
    }).catch(e => {
      t.fail(e);
      t.end();
    });
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('Error a stream with pending read()s', t => {
  let readCount = 0;

  let error = undefined;
  let done = undefined;
  class Source {
    start(close, error_) {
      error = error_;
    }

    read(view, done_) {
      t.equal(view.byteLength, 16);
      ++readCount;

      done = done_;
    }

    cancel(reason) {
      t.fail('cancel() is called');
      t.end();
    }
  }

  const testError = new TypeError('test');

  const rs = new ThinByobByteStreamReader(new Source());

  let firstReadRejected = false;
  rs.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);
    t.equal(view.byteLength, 0);
    t.equal(view.buffer.byteLength, 16);
    firstReadRejected = true;
  });
  rs.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);
    t.equal(view.byteLength, 0);
    t.equal(view.buffer.byteLength, 16);
    t.equal(firstReadRejected, true);
    t.equal(readCount, 2);
    t.end();
  });

  error(testError);
  // Return the buffers.
  done();
  done();
});
