const test = require('tape-catch');

test('Operation stream pair is constructed', t => {
  const pair = createOperationQueue({
    size() {
      return 1;
    },
    shouldApplyBackpressure() {
      return false;
    }
  });

  t.end();
});

class NoBackpressureStrategy {
}

class ApplyBackpressureWhenNonEmptyStrategy {
  shouldApplyBackpressure(queueSize) {
    return queueSize > 0;
  }
}

class AdjustableArrayBufferStrategy {
  constructor() {
    this._window = 0;
  }

  size(ab) {
    return ab.byteLength;
  }
  shouldApplyBackpressure(queueSize) {
    return queueSize >= this._window;
  }
  space(queueSize) {
    return Math.max(0, this._window - queueSize);
  }
  onWindowUpdate(window) {
    this._window = window;
  }
}

class AdjustableStringStrategy {
  constructor() {
    this._window = 0;
  }

  size(s) {
    return s.length;
  }
  shouldApplyBackpressure(queueSize) {
    return queueSize >= this._window;
  }
  space(queueSize) {
    return Math.max(0, this._window - queueSize);
  }
  onWindowUpdate(window) {
    this._window = window;
  }
}

test('Synchronous write, read and completion of the operation', t => {
  const pair = createOperationQueue(new ApplyBackpressureWhenNonEmptyStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  t.equals(wos.state, 'writable');
  t.equals(ros.state, 'waiting');

  const status = wos.write('hello');

  t.equals(wos.state, 'waiting');
  t.equals(ros.state, 'readable');

  t.equals(status.state, 'waiting');

  const op = ros.readOperation();
  t.equals(op.argument, 'hello');

  t.equals(ros.state, 'waiting');
  t.equals(wos.state, 'writable');

  t.equals(status.state, 'waiting');

  op.complete('world');

  t.equals(status.state, 'completed');
  t.equals(status.result, 'world');

  t.end();
});

test('Asynchronous write, read and completion of the operation', t => {
  const pair = createOperationQueue(new ApplyBackpressureWhenNonEmptyStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  t.equals(ros.state, 'waiting');

  var calledComplete = false;

  ros.ready.then(() => {
    t.equals(ros.state, 'readable');

    const op = ros.readOperation();
    t.equals(op.argument, 'hello');

    t.equals(ros.state, 'waiting');

    op.complete('world');
    calledComplete = true;
  }, e => {
    t.fail(e);
    t.end();
  });

  t.equals(wos.state, 'writable');

  const status = wos.write('hello');

  t.equals(wos.state, 'waiting');

  t.equals(status.state, 'waiting');
  status.ready.then(() => {
    t.equals(calledComplete, true);

    t.equals(status.state, 'completed');
    t.equals(status.result, 'world');

    t.end();
  }, e => {
    t.fail(e);
    t.end();
  });
});

test('Asynchronous write, read and completion of the operation', t => {
  const pair = createOperationQueue(new AdjustableArrayBufferStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  t.equals(wos.state, 'waiting');

  ros.window = 5;
  t.equals(wos.state, 'writable');
  t.equals(wos.space, 5);

  ros.window = 0;
  const status = wos.write(new ArrayBuffer(10));

  t.equals(wos.state, 'waiting');
  t.equals(wos.space, 0);

  ros.window = 10;
  t.equals(wos.state, 'waiting');
  t.equals(wos.space, 0);

  ros.window = 15;
  t.equals(wos.state, 'writable');
  t.equals(wos.space, 5);

  ros.window = 20;
  t.equals(wos.state, 'writable');
  t.equals(wos.space, 10);

  ros.read();

  t.equals(wos.state, 'writable');
  t.equals(wos.space, 20);

  t.end();
});

test('abort()', t => {
  t.plan(9);

  const pair = createOperationQueue(new AdjustableStringStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  const helloStatus = wos.write('hello');
  const worldStatus = wos.write('world');

  const testError = new TypeError('foo');
  const testCompletion = 'good';

  const status = wos.abort(testError);
  t.equals(wos.state, 'aborted', 'wos.state');
  status.ready.then(() => {
    t.equals(status.state, 'completed', 'status.state');
    t.equals(status.result, testCompletion, 'status.result');
  });

  helloStatus.ready.then(() => {
    t.equals(helloStatus.state, 'errored', 'helloStatus.state');
    t.equals(helloStatus.result.message, 'aborted', 'helloStatus.result');
  });
  worldStatus.ready.then(() => {
    t.equals(worldStatus.state, 'errored', 'worldStatus.state');
    t.equals(worldStatus.result.message, 'aborted', 'worldStatus.result');
  });
  ros.aborted.then(() => {
    t.equals(ros.state, 'aborted', 'ros.state');
    t.equals(ros.abortOperation.argument, testError, 'ros.abortOperation.argument');

    ros.abortOperation.complete(testCompletion);
  });
});

test('cancel()', t => {
  t.plan(9);

  const pair = createOperationQueue(new AdjustableStringStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  const helloStatus = wos.write('hello');
  const worldStatus = wos.write('world');

  const testError = new TypeError('foo');
  const testCompletion = 'good';

  const status = ros.cancel(testError);
  t.equals(ros.state, 'cancelled', 'ros.state');
  status.ready.then(() => {
    t.equals(status.state, 'completed', 'status.state');
    t.equals(status.result, testCompletion, 'status.result');
  });

  helloStatus.ready.then(() => {
    t.equals(helloStatus.state, 'errored', 'helloStatus.state');
    t.equals(helloStatus.result, testError, 'helloStatus.result');
  });
  worldStatus.ready.then(() => {
    t.equals(worldStatus.state, 'errored', 'worldStatus.state');
    t.equals(worldStatus.result, testError, 'worldStatus.result');
  });
  wos.errored.then(() => {
    t.equals(wos.state, 'cancelled', 'wos.state');
    t.equals(wos.cancelOperation.argument, testError, 'wos.cancelOperation.argument');

    wos.cancelOperation.complete(testCompletion);
  });
});

test('pipeOperationStreams()', t => {
  const pair0 = createOperationQueue(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationQueue(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  var helloStatus;
  t.equals(wos0.state, 'waiting');
  // Check that wos0 becomes writable.
  wos0.ready.then(() => {
    t.equals(wos0.state, 'writable');

    helloStatus = wos0.write('hello');

    // Just write without state check.
    wos0.write('world');
    wos0.close();
  });

  pipeOperationStreams(ros0, wos1)
      .catch(e => {
        t.fail(e);
        t.end();
      });

  t.equals(ros1.state, 'waiting');

  ros1.window = 20;

  t.equals(ros1.state, 'waiting');

  ros1.ready.then(() => {
    t.equals(ros1.state, 'readable');
    const op0 = ros1.readOperation();
    t.equals(op0.type, 'data');
    t.equals(op0.argument, 'hello');

    op0.complete('hi');

    t.equals(ros1.state, 'readable');
    const op1 = ros1.readOperation();
    t.equals(op1.type, 'data');
    t.equals(op1.argument, 'world');

    t.equals(ros1.state, 'readable');
    const op2 = ros1.readOperation();
    t.equals(op2.type, 'close');

    t.equals(helloStatus.state, 'waiting');
    helloStatus.ready.then(() => {
      t.equals(helloStatus.state, 'completed');
      t.equals(helloStatus.result, 'hi');
      t.end();
    });
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('pipeOperationStreams(): abort() propagation', t => {
  t.plan(9);

  const pair0 = createOperationQueue(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationQueue(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  const helloStatus = wos0.write('hello');
  const worldStatus = wos0.write('world');

  const testError = new TypeError('foo');
  const testCompletion = 'good';

  const pipePromise = pipeOperationStreams(ros0, wos1);
  pipePromise
      .then(
          v => t.fail('pipePromise is fulfilled with ' + v),
          e => t.equals(e.message, 'aborted', 'rejection reason of pipePromise'));

  const status = wos0.abort(testError);
  status.ready.then(() => {
    t.equals(status.state, 'completed', 'status.state');
    t.equals(status.result, testCompletion, 'status.result');
  });

  helloStatus.ready.then(() => {
    t.equals(helloStatus.state, 'errored', 'helloStatus.state');
    t.equals(helloStatus.result.message, 'aborted', 'helloStatus.result');
  });
  worldStatus.ready.then(() => {
    t.equals(worldStatus.state, 'errored', 'worldStatus.state');
    t.equals(worldStatus.result.message, 'aborted', 'worldStatus.result');
  });
  ros1.aborted.then(() => {
    t.equals(ros1.state, 'aborted', 'ros.state');
    t.equals(ros1.abortOperation.argument, testError, 'ros1.abortOperation.argument');

    ros1.abortOperation.complete(testCompletion);
  });
});

test('pipeOperationStreams(): cancel() propagation', t => {
  t.plan(9);

  const pair0 = createOperationQueue(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationQueue(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  const helloStatus = wos0.write('hello');
  const worldStatus = wos0.write('world');

  const testError = new TypeError('foo');
  const testCompletion = 'good';

  const pipePromise = pipeOperationStreams(ros0, wos1);
  pipePromise
      .then(
          v => t.fail('pipePromise is fulfilled with ' + v),
          e => t.equals(e.message, 'dest is cancelled', 'rejection reason of pipePromise'));

  const status = ros1.cancel(testError);
  status.ready.then(() => {
    t.equals(status.state, 'completed', 'status.state');
    t.equals(status.result, testCompletion, 'status.result');
  });

  helloStatus.ready.then(() => {
    t.equals(helloStatus.state, 'errored', 'helloStatus.state');
    t.equals(helloStatus.result, testError, 'helloStatus.result');
  });
  worldStatus.ready.then(() => {
    t.equals(worldStatus.state, 'errored', 'worldStatus.state');
    t.equals(worldStatus.result, testError, 'worldStatus.result');
  });
  wos0.errored.then(() => {
    t.equals(wos0.state, 'cancelled', 'wos0.state');
    t.equals(wos0.cancelOperation.argument, testError, 'wos0.cancelOperation.argument');

    wos0.cancelOperation.complete(testCompletion);
  });
});

test('Transformation example: Byte counting', t => {
  function byteCountingTransform(source, dest) {
    return new Promise((resolve, reject) => {
      let count = 0;

      function disposeStreams(error) {
        if (dest.state !== 'cancelled') {
          dest.cancel(error);
        }
        if (source.state !== 'aborted') {
          source.abort(error);
        }
      }

      function loop() {
        for (;;) {
          if (source.state === 'aborted') {
            if (dest.state !== 'cancelled') {
              jointOps(source.abortOperation, dest.cancel(source.abortOperation.argument));
            }
            return;
          }
          if (dest.state === 'cancelled') {
            if (source.state !== 'aborted') {
              jointOps(dest.cancelOperation, source.abort(dest.cancelOperation.argument));
            }
            return;
          }

          if (dest.state === 'writable') {
            if (source.state === 'readable') {
              const op = source.readOperation();
              if (op.type === 'data') {
                count += op.argument.length;
                op.complete();
              } else if (op.type === 'close') {
                dest.write(count);
                dest.close();
                op.complete();

                return;
              } else {
                disposeStreams(new TypeError('unexpected operation type: ' + op.type));
                return;
              }

              continue;
            } else {
              if (dest.space > 0) {
                source.window = 1;
              }
            }
          }

          selectOperationStreams(source, dest)
              .then(loop)
              .catch(disposeStreams);
          return;
        }
      }
      loop();
    });
  }

  const pair0 = createOperationQueue(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationQueue(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  byteCountingTransform(ros0, wos1)
      .catch(e => {
        t.fail(e);
        t.end();
      });

  wos0.write('hello');
  wos0.write('world');
  wos0.write('goodbye');
  wos0.close();

  ros1.window = 1;

  ros1.ready.then(() => {
    const v = ros1.read();
    t.equals(v, 17);
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

function fillArrayBufferView(view, c, size) {
  if (size === undefined) {
    size = view.byteLength;
  }
  for (var i = 0; i < size; ++i) {
    view[i] = c;
  }
}

class FakeFileBackedByteSource {
  constructor() {
    this._bytesToWrite = 1024;
  }

  createBufferProducingStreamWithPool(buffers) {
    class Puller {
      constructor(file, buffers, writableStream) {
        this._writableStream = writableStream;

        this._file = file;
        this._fileReadPromise = undefined;

        this._buffersAvailable = buffers;

        this._buffersPassedToUser = [];

        this._loop();
      }

      _handleFileReadResult(buffer, result) {
        this._fileReadPromise = undefined;
        const status = this._writableStream.write(result.view);
        this._buffersPassedToUser.push({buffer, status});
        if (result.closed) {
          this._writableStream.close();
        }
      }

      _select() {
        const promises = [];

        const ws = this._writableStream;

        if (ws.state === 'writable') {
          promises.push(ws.errored);
        } else if (ws.state === 'waiting') {
          promises.push(ws.ready);
        }

        if (this._fileReadPromise !== undefined) {
          promises.push(this._fileReadPromise);
        }

        if (this._buffersPassedToUser.length > 0) {
          promises.push(this._buffersPassedToUser[0].status.ready);
        }

        Promise.race(promises)
            .then(this._loop.bind(this))
            .catch(ws.abort.bind(ws));
      }

      _loop() {
        const ws = this._writableStream;

        for (;;) {
          if (ws.state === 'cancelled') {
            return;
          }

          var hasProgress = false;

          if (this._buffersPassedToUser.length > 0) {
            const entry = this._buffersPassedToUser[0];
            const status = entry.status;
            if (status.state === 'completed') {
              this._buffersPassedToUser.shift();

              this._buffersAvailable.push(entry.buffer);

              hasProgress = true;
              // Keep going.
            } else if (status.state === 'errored') {
              ws.abort(status.result);
              return;
            }
          }

          if (this._fileReadPromise === undefined &&
              this._buffersAvailable.length > 0 &&
              ws.state === 'writable') {
            const buffer = this._buffersAvailable.shift();

            // Clear the acquired buffer for testing.
            const view = new Uint8Array(buffer);
            fillArrayBufferView(view, 0);

            this._fileReadPromise = this._file._readInto(view)
                .then(this._handleFileReadResult.bind(this, buffer))
                .catch(ws.abort);

            hasProgress = true;
          }

          if (hasProgress) {
            continue;
          }

          this._select();
          return;
        }
      }
    }

    const pair = createOperationQueue(new AdjustableArrayBufferStrategy());
    new Puller(this, buffers, pair.writable);
    return pair.readable;
  }

  // Returns a WritableOperationStream.
  //
  // Example semantics:
  //
  // POSIX socket:
  // - The stream becomes writable when epoll(7) returns, and stays to be writable until read(2) returns EAGAIN.
  // - The status returned on write() call on the stream will set to the number of bytes written into the buffer passed
  //   on write() call.
  //
  // Blocking or async I/O interfaces which takes a buffer on reading function call:
  // - The stream is always writable.
  // - Same as POSIX socket.
  //
  // I/O that tells us how much data can be read:
  // - Hide window setter/getter to the user but adjust based on the info (how much data can be read), so that the user
  //   can know the info via space getter.
  createBufferFillingStream() {
    class Filler {
      constructor(file, readableStream) {
        this._readableStream = readableStream;
        this._readableStream.window = 1;

        this._currentRequest = undefined;

        this._file = file;

        this._fileReadStatus = undefined;

        this._loop();
      }

      _handleFileReadCompletion() {
        this._currentRequest.complete(this._fileReadStatus.result);
        this._currentRequest = undefined;

        this._fileReadStatus = undefined;
      }

      _handleFileReadError() {
        const error = this._fileReadStatus.result;

        this._currentRequest.error(error);
        this._currentRequest = undefined;

        this._readableStream.cancel(error);

        this._fileReadStatus = undefined;
      }

      _transformReadFromFileFulfillment(result) {
        this._fileReadStatus.state = 'completed';
        this._fileReadStatus.result = {closed: result.closed, bytesWritten: result.view.byteLength};
      }

      _transformReadFromFileRejection(e) {
        this._fileReadStatus.state = 'errored';
        this._fileReadStatus.result = e;
      }

      _readFromFile() {
        const op = this._readableStream.readOperation();

        if (op.type === 'close') {
          return;
        }
        // Assert: op.type === 'data'.

        this._currentRequest = op;

        const status = {};
        status.state = 'waiting';
        status.ready = this._file._readInto(op.argument)
            .then(this._transformReadFromFileFulfillment.bind(this))
            .catch(this._transformReadFromFileRejection.bind(this));

        this._fileReadStatus = status;
      }

      _select() {
        const promises = [];

        const rs = this._readableStream;

        if (rs.state === 'readable') {
          promises.push(rs.aborted);
        } else if (rs.state === 'waiting') {
          promises.push(rs.ready);
        }

        if (this._fileReadStatus !== undefined && this._fileReadStatus.state === 'waiting') {
          promises.push(this._fileReadStatus.ready);
        }

        Promise.race(promises)
            .then(this._loop.bind(this))
            .catch(rs.cancel.bind(rs));
      }

      _loop() {
        const rs = this._readableStream;

        for (;;) {
          if (rs.state === 'aborted') {
            if (this._currentRequest !== undefined) {
              this._currentRequest.error(rs.abortOperation.argument);
            }

            return;
          }

          if (this._currentRequest !== undefined) {
            if (this._fileReadStatus.state === 'errored') {
              this._handleFileReadError();
              return;
            } else if (this._fileReadStatus.state === 'completed') {
              this._handleFileReadCompletion();
            }
          }

          if (rs.state === 'readable' && this._currentRequest === undefined) {
            this._readFromFile();
            continue;
          }

          this._select();
          return;
        }
      }
    }

    const pair = createOperationQueue(new AdjustableArrayBufferStrategy());
    new Filler(this, pair.readable);
    return pair.writable;
  }

  _readInto(view) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const bytesToWriteThisTime = Math.min(this._bytesToWrite, view.byteLength);

          fillArrayBufferView(view, 1, bytesToWriteThisTime);

          this._bytesToWrite -= bytesToWriteThisTime;

          const writtenRegion = new Uint8Array(view.buffer, view.byteOffset, bytesToWriteThisTime);
          if (this._bytesToWrite === 0) {
            resolve({closed: true, view: writtenRegion});
          } else {
            resolve({closed: false, view: writtenRegion});
          }
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }
}

class BytesSetToOneExpectingByteSinkInternalWriter {
  constructor(sink, readableStream) {
    this._readableStream = readableStream;

    this._sink = sink;

    this._loop();
  }

  _loop() {
    const rs = this._readableStream;

    for (;;) {
      if (rs.state === 'readable') {
        const op = rs.readOperation();
        if (op.type === 'data') {
          const view = op.argument;

          // Verify contents of the buffer.
          for (var i = 0; i < view.byteLength; ++i) {
            if (view[i] === 1) {
              this._sink._count(1);
            }
          }

          // Release the buffer.
          op.complete();

          continue;
        } else if (op.type === 'close') {
          // Acknowledge the closure.
          op.complete();

          this._sink._complete();
        } else {
          this._sink._error(op.type);
        }
      } else if (rs.state === 'waiting') {
        rs.ready
            .then(this._loop.bind(this))
            .catch(this._sink._error.bind(this._sink));
      } else if (rs.state === 'aborted') {
        this._sink._error(rs.abortOperation.argument);
      } else {
        this._sink._error(rs.state);
      }
      return;
    }
  }
}

class BytesSetToOneExpectingByteSink {
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

  _complete() {
    this._resolveResultPromise(this._bytesRead);
  }

  _error(e) {
    this._rejectResultPromise(e);
  }

  createBufferProducingStream() {
    class BufferProvidingWriter {
      constructor(sink, writableStream) {
        this._writableStream = writableStream;

        this._currentReadStatus = undefined;

        this._buffer = new ArrayBuffer(16);

        this._sink = sink;

        this._loop();
      }

      _handleReadCompletion() {
        const bytesWritten = this._currentReadStatus.result.bytesWritten;
        const closed = this._currentReadStatus.result.closed;

        // Verify contents of the buffer.
        const view = new Uint8Array(this._buffer, 0, bytesWritten);
        for (var i = 0; i < bytesWritten; ++i) {
          if (view[i] === 1) {
            this._sink._count(1);
          }
        }

        this._currentReadStatus = undefined;

        return closed;
      }

      _select() {
        const promises = [];

        const ws = this._writableStream;

        if (ws.state === 'writable') {
          promises.push(ws.errored);
        } else if (ws.state === 'waiting') {
          promises.push(ws.ready);
        }

        if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'waiting') {
          promises.push(this._currentReadStatus.ready);
        }

        Promise.race(promises)
            .then(this._loop.bind(this))
            .catch(this._sink._error.bind(this._sink));
      }

      _loop() {
        const ws = this._writableStream;

        for (;;) {
          if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'errored') {
            const error = this._currentReadStatus.result;
            this._currentReadStatus = undefined;

            ws.abort(error);
            this._sink._error(error);

            return;
          }

          if (ws.state === 'cancelled') {
            this._sink._error(ws.cancelOperation.argument);
            return;
          }

          let hasProgress = false;

          if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'completed') {
            const closed = this._handleReadCompletion();
            if (closed) {
              ws.close();
              this._sink._complete();
              return;
            }

            hasProgress = true;
          }

          if (ws.state === 'writable' && this._currentReadStatus === undefined) {
            this._currentReadStatus = ws.write(new Uint8Array(this._buffer));

            hasProgress = true;
          }

          if (hasProgress) {
            continue;
          }

          this._select();
          return;
        }
      }
    }

    const pair = createOperationQueue(new AdjustableArrayBufferStrategy());
    new BufferProvidingWriter(this, pair.writable);
    return pair.readable;
  }

  createBufferConsumingStream() {
    const pair = createOperationQueue(new AdjustableArrayBufferStrategy());
    new BytesSetToOneExpectingByteSinkInternalWriter(this, pair.readable);
    return pair.writable;
  }

  writeFrom(readableStream) {
    new BytesSetToOneExpectingByteSinkInternalWriter(this, readableStream);
  }

}

test('Piping from a source with a buffer pool to a buffer taking sink', t => {
  const pool = [];
  for (var i = 0; i < 10; ++i) {
    pool.push(new ArrayBuffer(10));
  }

  const file = new FakeFileBackedByteSource();

  const sink = new BytesSetToOneExpectingByteSink();
  const bufferConsumingStream = sink.createBufferConsumingStream();
  bufferConsumingStream.window = 64;

  // pipeOperationStreams automatically adjusts window of the readable side.
  const pipePromise = pipeOperationStreams(file.createBufferProducingStreamWithPool(pool), bufferConsumingStream);
  pipePromise.catch(e => {
    t.fail(e);
    t.end();
  });

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);

    pipePromise.then(() => {
      Promise.resolve().then(() => {
        // Check that the buffers have been returned to the pool.
        t.equals(pool.length, 10);
        t.end();
      });
    });
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('Consuming bytes from a source with a buffer pool via the ReadableOperationStream interface', t => {
  const pool = [];
  for (var i = 0; i < 10; ++i) {
    pool.push(new ArrayBuffer(10));
  }

  const file = new FakeFileBackedByteSource();
  const bufferProducingStream = file.createBufferProducingStreamWithPool(pool);
  bufferProducingStream.window = 64;

  const sink = new BytesSetToOneExpectingByteSink();

  sink.writeFrom(bufferProducingStream);

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);

    Promise.resolve().then(() => {
      Promise.resolve().then(() => {
        // Check that the buffers have been returned to the pool.
        t.equals(pool.length, 10);
        t.end();
      });
    });
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('Piping from a buffer taking source to a sink with buffer', t => {
  const file = new FakeFileBackedByteSource();
  const bufferFillingStream = file.createBufferFillingStream();
  bufferFillingStream.window = 16;
  // This also works.
  // writableBufferProvidingStream.window = 16;

  const sink = new BytesSetToOneExpectingByteSink();
  const writableBufferProducingStream = sink.createBufferProducingStream();

  const pipePromise = pipeOperationStreams(writableBufferProducingStream, bufferFillingStream);
  pipePromise.catch(e => {
    t.fail(e);
    t.end();
  });

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);
    pipePromise.then(() => t.end());
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});
