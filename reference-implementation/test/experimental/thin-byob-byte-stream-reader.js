const test = require('tape-catch');

import { fillArrayBufferView } from '../../lib/experimental/thin-stream-utils';
import { ThinByobByteStreamReader } from '../../lib/experimental/thin-byob-byte-stream-reader';
import { FakeByteSource } from '../../lib/experimental/fake-byte-source';

test('Construct a ThinByobByteStreamReader', t => {
  class UnderlyingSource {
  }
  const underlyingSource = new UnderlyingSource();
  new ThinByobByteStreamReader(underlyingSource);
  t.end();
});

test('Read data from a reader', t => {
  const source = new FakeByteSource(1024);
  const reader = source.getByobReader();

  let bytesRead = 0;

  const buffer = new Uint8Array(16);

  function pump() {
    fillArrayBufferView(buffer, 0);
    reader.read(buffer).then(({value, done}) => {
      if (done) {
        t.equal(value.byteLength, 0);
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

test('Read data from a reader into a single Uint8Array', t => {
  const source = new FakeByteSource(1024, 10);
  const reader = source.getByobReader();

  let bytesRead = 0;

  const buffer = new Uint8Array(2048);
  fillArrayBufferView(buffer, 0);

  function pump() {
    reader.read(buffer.subarray(bytesRead)).then(({value, done}) => {
      if (done) {
        t.equal(value.byteLength, 0);
        t.equal(bytesRead, 1024);
        const buffer = new Uint8Array(value.buffer);
        for (let i = 0; i < bytesRead; ++i) {
          if (buffer[i] !== 1) {
            t.fail('buffer[' + i + '] is ' + buffer[i]);
            t.end();
            return;
          }
        }
        t.end();
        return;
      } else {
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

test('read() on a closed reader', t => {
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
  const reader = new ThinByobByteStreamReader(new Source());

  reader.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);

    t.equal(value.byteOffset, 0);
    t.equal(value.byteLength, 0);
    t.equal(value.buffer.byteLength, 16);

    reader.read(new Uint8Array(16)).then(({value, done}) => {
      t.equal(done, true);

      t.equal(value.byteOffset, 0);
      t.equal(value.byteLength, 0);
      t.equal(value.buffer.byteLength, 16);

      t.end();
    });
  });
});

test('Close a reader with pending read()s', t => {
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
  const reader = new ThinByobByteStreamReader(new Source());

  let firstReadFulfilled = false;
  reader.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);

    t.equal(value.byteOffset, 0);
    t.equal(value.byteLength, 0);
    t.equal(value.buffer.byteLength, 16);

    firstReadFulfilled = true;
  }).catch(e => {
    t.fail(e);
    t.end();
  });
  reader.read(new Uint8Array(16)).then(({value, done}) => {
    t.equal(done, true);

    t.equal(value.byteOffset, 0);
    t.equal(value.byteLength, 0);
    t.equal(value.buffer.byteLength, 16);

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

test('read() on a errored reader', t => {
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
  const reader = new ThinByobByteStreamReader(new Source());

  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view.byteOffset, 0);
    t.equal(view.byteLength, 0);
    t.equal(view.buffer.byteLength, 16);

    reader.read(new Uint8Array(16)).catch(({reason, view}) => {
      t.equal(reason, testError);

      t.equal(view.byteOffset, 0);
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

test('Error a reader with pending read()s', t => {
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
  const reader = new ThinByobByteStreamReader(new Source());

  const testError = new TypeError('test');

  let firstReadRejected = false;
  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view.byteOffset, 0);
    t.equal(view.byteLength, 0);
    t.equal(view.buffer.byteLength, 16);

    firstReadRejected = true;
  });
  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view.byteOffset, 0);
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

test('read() on a fatal-errored reader', t => {
  const testError = new TypeError('test');

  class Source {
    start(close, error, fatalError) {
      fatalError(testError);
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
  const reader = new ThinByobByteStreamReader(new Source());

  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view, undefined);

    reader.read(new Uint8Array(16)).catch(({reason, view}) => {
      t.equal(reason, testError);

      t.equal(view, undefined);

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

test('Fatal-error a reader with pending read()s', t => {
  let readCount = 0;

  let fatalError = undefined;
  let done = undefined;
  class Source {
    start(close, error, fatalError_) {
      fatalError = fatalError_;
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
  const reader = new ThinByobByteStreamReader(new Source());

  const testError = new TypeError('test');

  let firstReadRejected = false;
  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view, undefined);

    firstReadRejected = true;
  });
  reader.read(new Uint8Array(16)).catch(({reason, view}) => {
    t.equal(reason, testError);

    t.equal(view, undefined);

    t.equal(firstReadRejected, true);
    t.equal(readCount, 2);
    t.end();
  });

  fatalError(testError);
  t.throws(done, /TypeError/);
});
