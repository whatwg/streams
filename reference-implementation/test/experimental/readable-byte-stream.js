var test = require('tape');

import ReadableByteStream from '../../lib/experimental/readable-byte-stream';

test('ReadableByteStream can be constructed with no arguments', t => {
  t.doesNotThrow(() => new ReadableByteStream());
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

  var waitPromise = rbs.wait;

  t.strictEqual(rbs.state, 'waiting');

  notifyReady();

  t.strictEqual(rbs.state, 'readable');

  waitPromise.then(
      () => t.end(),
      error => {
        t.fail(error);
        t.end();
      });
});

test('ReadableByteStream: Stay in readable state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      ++readIntoCount;
      t.strictEqual(arraybuffer, buffer);
      t.strictEqual(offset, 2);
      t.strictEqual(size, 5);

      return 4;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.strictEqual(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 2, 5);
  t.equal(readIntoCount, 1);
  t.strictEqual(bytesRead, 4);
  t.strictEqual(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: readInto()\'s offset and size argument are automatically calculated if omitted', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      ++readIntoCount;
      t.strictEqual(offset, 0);
      t.strictEqual(size, 10);

      return size;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var bytesRead = rbs.readInto(new ArrayBuffer(10));
  t.equal(readIntoCount, 1);
  t.strictEqual(bytesRead, 10);
  t.strictEqual(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: readInto()\'s size argument is automatically calculated if omitted', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      ++readIntoCount;
      t.strictEqual(offset, 3);
      t.strictEqual(size, 7);

      return size;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  var bytesRead = rbs.readInto(new ArrayBuffer(10), 3);
  t.equal(readIntoCount, 1);
  t.strictEqual(bytesRead, 7);
  t.strictEqual(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: Enter waiting state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      ++readIntoCount;
      t.strictEqual(arraybuffer, buffer);
      t.strictEqual(offset, 0);
      t.strictEqual(size, 10);

      return -2;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.strictEqual(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 0, 10);
  t.equal(readIntoCount, 1);
  t.strictEqual(bytesRead, 0);
  t.strictEqual(rbs.state, 'waiting');

  t.end();
});

test('ReadableByteStream: Enter closed state on readInto() call', t => {
  var buffer = new ArrayBuffer(10);

  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      ++readIntoCount;
      t.strictEqual(arraybuffer, buffer);
      t.strictEqual(offset, 0);
      t.strictEqual(size, 10);

      return -1;
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.strictEqual(rbs.state, 'readable');
  var bytesRead = rbs.readInto(buffer, 0, 10);
  t.equal(readIntoCount, 1);
  t.strictEqual(bytesRead, 0);
  t.strictEqual(rbs.state, 'closed');

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
    readInto(arraybuffer, offset, size) {
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
  t.strictEqual(rbs.state, 'errored');

  rbs.closed.then(
      () => {
        t.fail('waitPromise is fulfilled unexpectedly');
        t.end();
      },
      error => {
        t.strictEqual(error.constructor, RangeError);
        t.end();
      });
});

test('ReadableByteStream: Enter errored state when readInto()\'s return value is NaN', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
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
  t.strictEqual(rbs.state, 'errored');

  rbs.closed.then(
      () => {
        t.fail('waitPromise is fulfilled unexpectedly');
        t.end();
      },
      error => {
        t.strictEqual(error.constructor, RangeError);
        t.end();
      });
});

test('ReadableByteStream: readInto() fails if the range specified by offset and size is invalid', t => {
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 5, 10), /RangeError/);
  t.strictEqual(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), -5, 10), /RangeError/);
  t.strictEqual(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0, 20), /RangeError/);
  t.strictEqual(rbs.state, 'readable');

  t.throws(() => rbs.readInto(new ArrayBuffer(10), 0, -10), /RangeError/);
  t.strictEqual(rbs.state, 'readable');

  t.end();
});

test('ReadableByteStream: Enter errored state when readInto()\'s return value is smaller than -2', t => {
  var readIntoCount = 0;
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
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
  t.strictEqual(rbs.state, 'errored');

  t.end();
});

test('ReadableByteStream: readInto() must throw when in waiting state', t => {
  var rbs = new ReadableByteStream({
    start(notifyReady) {
      notifyReady();
    },
    readInto(arraybuffer, offset, size) {
      t.fail('Unexpected readInto call');
      t.end();
    },
    cancel() {
      t.fail('Unexpected cancel call');
      t.end();
    }
  });

  t.throws(() => rbs.readInto(), /TypeError/);
  t.strictEqual(rbs.state, 'readable', 'readInto() call in invalid state doesn\'t error the stream');

  t.end();
});

test('ReadableByteStream: Have readInto() write up to 10 bytes for each call', t => {
  var totalBytesRead = 0;
  var dataSize = 64;
  var doWait = false;
  var notifyReady;
  var rbs = new ReadableByteStream({
    start(notifyReady_) {
      notifyReady = notifyReady_;
      setTimeout(notifyReady, 0);
    },
    readInto(arraybuffer, offset, size) {
      if (totalBytesRead == dataSize) {
        return -1;
      }

      if (doWait) {
        doWait = false;
        setTimeout(notifyReady, 0);
        return -2;
      }
      doWait = true;

      var view = new Uint8Array(arraybuffer, offset, size);
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
        rbs.wait
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
