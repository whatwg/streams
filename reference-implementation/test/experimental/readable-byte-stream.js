var test = require('tape');

import ReadableByteStream from '../../lib/experimental/readable-byte-stream';
import WritableStream from '../../lib/writable-stream';

test('ReadableByteStream can be constructed with no arguments', t => {
  t.doesNotThrow(() => new ReadableByteStream());
  t.end();
});

test('ReadableByteStream cannot be constructed if readBufferSize is a negative integer', t => {
  t.throws(() => new ReadableByteStream({readBufferSize: -1}), /RangeError/);
  t.end();
});

test('ReadableByteStream: Call notifyReady() asynchronously to enter readable state', t => {
  var notifyReady;
  var rbs = new ReadableByteStream({
    start(notifyReady_) {
      notifyReady = notifyReady_;
    },
    readInto() {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var readyPromise = rbs.ready;

  t.equal(rbs.state, 'waiting');

  notifyReady();

  t.equal(rbs.state, 'readable');

  readyPromise.then(
    () => t.end(),
    error => {
      t.fail(error);
      t.end();
    }
  );
});

test('ReadableByteStream: read() must throw if constructed with passing undefined for readBufferSize', t => {
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    },
    readBufferSize: undefined
  });

  t.throws(() => rbs.read(), /TypeError/);
  t.end();
});

test('ReadableByteStream: Stay in readable state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      t.equal(arrayBuffer, buffer);
      t.equal(offset, 2);
      t.equal(size, 5);

      return 4;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.equal(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 2, 5);
  t.equal(readIntoCount, 1);
  t.equal(bytesRead, 4);
  t.equal(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: readInto()\'s offset and size argument are automatically calculated if omitted', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      t.equal(offset, 0);
      t.equal(size, 10);

      return size;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var bytesRead = rbs.readInto(new ArrayBuffer(10));
  t.equal(readIntoCount, 1);
  t.equal(bytesRead, 10);
  t.equal(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: readInto()\'s size argument is automatically calculated if omitted', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      t.equal(offset, 3);
      t.equal(size, 7);

      return size;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var bytesRead = rbs.readInto(new ArrayBuffer(10), 3);
  t.equal(readIntoCount, 1);
  t.equal(bytesRead, 7);
  t.equal(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: Enter waiting state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      t.equal(arrayBuffer, buffer);
      t.equal(offset, 0);
      t.equal(size, 10);

      return -2;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.equal(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 0, 10);
  t.equal(readIntoCount, 1);
  t.equal(bytesRead, 0);
  t.equal(rbs.state, 'waiting');

  t.end();
});

test('ReadableByteStream: Enter closed state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      t.equal(arrayBuffer, buffer);
      t.equal(offset, 0);
      t.equal(size, 10);

      return -1;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.equal(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 0, 10);
  t.equal(readIntoCount, 1);
  t.equal(bytesRead, 0);
  t.equal(rbs.state, 'closed');

  rbs.closed.then(
      () => t.end(),
      error => {
        t.fail(error);
        t.end();
      });
});

test('ReadableByteStream: Enter errored state when readInto()\'s return value is out of range', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      return 5;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 3, 3), /RangeError/);
  t.equal(readIntoCount, 1);
  t.equal(rbs.state, 'errored');

  rbs.closed.then(
      () => {
        t.fail('closed is fulfilled unexpectedly');
        t.end();
      },
      error => {
        t.equal(error.constructor, RangeError);
        t.end();
      });
});

test('ReadableByteStream: Enter errored state when readInto()\'s return value is NaN', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      return NaN;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 3, 3), /RangeError/);
  t.equal(readIntoCount, 1);
  t.equal(rbs.state, 'errored');

  rbs.closed.then(
      () => {
        t.fail('closed is fulfilled unexpectedly');
        t.end();
      },
      error => {
        t.equal(error.constructor, RangeError);
        t.end();
      });
});

test('ReadableByteStream: readInto() fails if the range specified by offset and size is invalid', t => {
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 5, 10), /RangeError/);
  t.equal(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), -5, 10), /RangeError/);
  t.equal(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0, 20), /RangeError/);
  t.equal(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0, -10), /RangeError/);
  t.equal(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: Enter errored state when readInto()\'s return value is smaller than -2', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      ++readIntoCount;
      return -3;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0 ,10), /RangeError/);
  t.equal(readIntoCount, 1);
  t.equal(rbs.state, 'errored');

  t.end();
});

test('ReadableByteStream: read() must throw when in waiting state', t => {
  var rbs = new ReadableByteStream({
    readInto(arrayBuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.equal(rbs.state, 'waiting');
  t.throws(() => rbs.read(), /TypeError/);
  t.equal(rbs.state, 'waiting', 'read() call in invalid state doesn\'t error the stream');

  t.end();
});

test('ReadableByteStream: readInto() must throw when in waiting state', t => {
  var rbs = new ReadableByteStream({
    readInto(arrayBuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.equal(rbs.state, 'waiting');
  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0, 10), /TypeError/);
  t.equal(rbs.state, 'waiting', 'readInto() call in invalid state doesn\'t error the stream');

  t.end();
});

test('ReadableByteStream: read() delegates to readInto()', t => {
  var buffer = new ArrayBuffer(10);

  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      t.fail('unexpected call to underlying source readInto');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    },
    readBufferSize: 10
  });

  var readIntoArrayBuffer, readIntoOffset, readIntoSize;
  rbs.readInto = function (arrayBuffer, offset, size) {
    readIntoArrayBuffer = arrayBuffer;
    readIntoOffset = offset;
    readIntoSize = size;

    return 5;
  };

  var readArrayBuffer = rbs.read();

  t.ok(readIntoArrayBuffer instanceof ArrayBuffer, 'An ArrayBuffer was passed to readInto');
  t.equal(readIntoOffset, 0, 'readInto was called with offset 0');
  t.equal(readIntoSize, 10, 'readInto was called with the established readBufferSize');

  t.equal(readArrayBuffer.byteLength, 5, 'The read array buffer was of the length returned by readInto');

  t.end();
});

test('ReadableByteStream: ArrayBuffer allocated by read() is partially used', t => {
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      t.equal(offset, 0);
      t.equal(size, 10);

      var view = new Uint8Array(arrayBuffer, offset, size);
      for (var i = 0; i < 8; ++i) {
        view[i] = i;
      }

      return 8;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    },
    readBufferSize: 10
  });

  t.equal(rbs.state, 'readable');
  var data = rbs.read();
  t.equal(data.byteLength, 8);
  var view = new Uint8Array(data);
  for (var i = 0; i < 8; ++i) {
    if (view[i] != i) {
      t.fail('Unexpected value ' + view[i] + ' at data[' + i + ']');
      t.end();
    }
  }

  t.end();
});

test('ReadableByteStream: Have source\'s readInto() write up to 10 bytes for each call', t => {
  var totalBytesRead = 0;
  var dataSize = 64;
  var doWait = false;
  var notifyReady;
  var rbs = new ReadableByteStream({
    start(notifyReady_) {
      notifyReady = notifyReady_;
      setTimeout(notifyReady, 0);
    },
    readInto(arrayBuffer, offset, size) {
      if (totalBytesRead == dataSize) {
        return -1;
      }

      if (doWait) {
        doWait = false;
        setTimeout(notifyReady, 0);
        return -2;
      }
      doWait = true;

      var view = new Uint8Array(arrayBuffer, offset, size);
      if (size > 10) {
        size = 10;
      }
      var i = 0;
      for (; i < size; ++i) {
        if (totalBytesRead == dataSize) {
          break;
        }

        view[i] = totalBytesRead % 256;
        ++totalBytesRead;
      }

      return i;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var buffer = new ArrayBuffer(100);
  var bytesFilled = 0;
  function readAndProcess(v) {
    for (;;) {
      if (rbs.state === 'readable') {
        var bytesRead = rbs.readInto(buffer, bytesFilled);
        bytesFilled += bytesRead;
      } else if (rbs.state === 'waiting') {
        rbs.ready
            .then(readAndProcess, readAndProcess)
            .catch(
                error => {
                  t.fail(error);
                  t.end();
                });
        return;
      } else if (rbs.state === 'closed') {
        t.equal(bytesFilled, dataSize);
        var view = new Uint8Array(buffer);

        for (var i = 0; i < bytesFilled; ++i) {
          if (view[i] != i % 256) {
            t.fail('Unexpected value ' + view[i] + ' at view[' + i + ']');
            t.end();
          }
        }

        t.end();
        return;
      } else if (rbs.state === 'errored') {
        t.fail('rbs entered errored state unexpectedly');
        t.end();
        return;
      }
    }
  }
  readAndProcess();
});

test('ReadableByteStream: cancel() invokes source\'s cancel()', t => {
  var cancelCount = 0;
  var resolveSinkCancelPromise;
  var rbs = new ReadableByteStream({
    readInto(arrayBuffer, offset, size) {
      t.fail('readInto called');
      t.end();
    },
    cancel() {
      if (cancelCount > 0) {
        t.fail('Source\'s cancel() is called more than once');
        t.end();
        return;
      }

      ++cancelCount;
      return new Promise((resolve, reject) => {
        resolveSinkCancelPromise = resolve;
      });
    }
  });

  var resolvedSinkCancelPromise = false;
  var cancelPromiseFulfilled = false;
  var cancelPromise = rbs.cancel();
  cancelPromise.then(value => {
    t.equal(value, undefined, 'fulfillment value of cancelPromise must be undefined');
    cancelPromiseFulfilled = true;
    t.true(resolvedSinkCancelPromise);
    t.end();
  }).catch(r => {
    t.fail('cancelPromise is rejected: ' + r);
  });

  t.equal(cancelCount, 1);
  setTimeout(() => {
    t.false(cancelPromiseFulfilled);

    resolveSinkCancelPromise('Hello');
    resolvedSinkCancelPromise = true;
  }, 0);
});

test('ReadableByteStream: Transfer 1kiB using pipeTo()', t => {
  var generateCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arrayBuffer, offset, size) {
      var view = new Uint8Array(arrayBuffer);
      for (var i = 0; i < size; ++i) {
        if (generateCount == 1024) {
          if (i == 0)
            return -1;
          return i;
        }

        view[offset + i] = generateCount % 256;
        ++generateCount;
      }
      return size;
    },
    cancel() {
      t.fail('Source\'s cancel() is called');
      t.end();
    },
    readBufferSize: 10
  });

  var verifyCount = 0;
  var ws = new WritableStream({
    write(chunk) {
      var view = new Uint8Array(chunk);
      for (var i = 0; i < chunk.byteLength; ++i) {
        if (view[i] != verifyCount % 256) {
          t.fail('Unexpected character');
          t.end();
        }
        ++verifyCount;
      }
    },
    close() {
      t.equal(verifyCount, 1024);
      t.end();
    },
    abort() {
      t.fail('abort() is called');
      t.end();
    }
  });

  rbs.pipeTo(ws);
});
