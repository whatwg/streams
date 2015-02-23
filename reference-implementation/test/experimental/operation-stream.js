const test = require('tape-catch');

test('Operation stream pair is constructed', t => {
  const pair = createOperationStream({
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
  const pair = createOperationStream(new ApplyBackpressureWhenNonEmptyStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  t.equals(wos.state, 'writable');
  t.equals(ros.state, 'waiting');

  const status = wos.write('hello');

  t.equals(wos.state, 'waiting');
  t.equals(ros.state, 'readable');

  t.equals(status.state, 'waiting');

  const op = ros.read();
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
  const pair = createOperationStream(new ApplyBackpressureWhenNonEmptyStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  t.equals(ros.state, 'waiting');

  var calledComplete = false;

  ros.ready.then(() => {
    t.equals(ros.state, 'readable');

    const op = ros.read();
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
  })
});

test('Asynchronous write, read and completion of the operation', t => {
  const pair = createOperationStream(new AdjustableArrayBufferStrategy());
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

  ros.window = 10
  t.equals(wos.state, 'waiting');
  t.equals(wos.space, 0);

  ros.window = 15
  t.equals(wos.state, 'writable');
  t.equals(wos.space, 5);

  ros.window = 20
  t.equals(wos.state, 'writable');
  t.equals(wos.space, 10);

  ros.read();

  t.equals(wos.state, 'writable');
  t.equals(wos.space, 20);

  t.end();
});

test('Pipe', t => {
  const pair0 = createOperationStream(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationStream(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  const helloStatus = wos0.write('hello');
  wos0.write('world');
  wos0.close();

  pipeOperationStreams(ros0, wos1);

  t.equals(ros1.state, 'waiting');

  ros1.window = 20;

  t.equals(ros1.state, 'waiting');

  ros1.ready.then(() => {
    t.equals(ros1.state, 'readable');
    const op0 = ros1.read();
    t.equals(op0.type, 'data');
    t.equals(op0.argument, 'hello');

    op0.complete('hi');

    t.equals(ros1.state, 'readable');
    const op1 = ros1.read();
    t.equals(op1.type, 'data');
    t.equals(op1.argument, 'world');

    t.equals(ros1.state, 'readable');
    const op2 = ros1.read();
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

class FakeFile {
  constructor() {
    this._bytesToWrite = 1024;
  }

  readInto(view) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const bytesToWriteThisTime = Math.min(this._bytesToWrite, view.byteLength);

          for (var i = 0; i < bytesToWriteThisTime; ++i) {
            view[i] = 1;
          }

          this._bytesToWrite -= bytesToWriteThisTime;

          if (this._bytesToWrite === 0) {
            resolve({closed: true, view: new Uint8Array(view.buffer, view.byteOffset, bytesToWriteThisTime)});
          } else {
            resolve({closed: false, view: new Uint8Array(view.buffer, view.byteOffset, bytesToWriteThisTime)});
          }
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }
}

class FakeByteSourceWithBufferPool {
  constructor(buffers) {
    this._streams = createOperationStream(new AdjustableArrayBufferStrategy());

    this._file = new FakeFile();
    this._fileReadPromise = undefined;

    this._buffersAvailable = buffers;

    this._buffersPassedToUser = [];

    this._loop();
  }

  get stream() {
    return this._streams.readable;
  }

  _handleFileReadResult(buffer, result) {
    this._fileReadPromise = undefined;
    const status = this._streams.writable.write(result.view);
    this._buffersPassedToUser.push({buffer, status});
    if (result.closed) {
      this._streams.writable.close();
    }
  }

  _loop() {
    const wos = this._streams.writable;

    for (;;) {
      if (wos.state === 'cancelled') {
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
          wos.abort(status.result);
          return;
        }
      }

      if (this._fileReadPromise === undefined &&
          this._buffersAvailable.length > 0 &&
          wos.state === 'writable') {
        const buffer = this._buffersAvailable.shift();

        // Clear the acquired buffer for testing.
        const view = new Uint8Array(buffer);
        for (var i = 0; i < view.byteLength; ++i) {
          view[0] = 0;
        }

        this._fileReadPromise = this._file.readInto(view).then(
            this._handleFileReadResult.bind(this, buffer)).catch(e => wos.abort(e));

        hasProgress = true;
      }

      if (hasProgress) {
        continue;
      }

      const promisesToRace = [];

      if (wos.state === 'writable') {
        promisesToRace.push(wos.cancelled);
      } else if (wos.state === 'waiting') {
        promisesToRace.push(wos.ready);
      }

      if (this._fileReadPromise !== undefined) {
        promisesToRace.push(this._fileReadPromise);
      }

      if (this._buffersPassedToUser.length > 0) {
        promisesToRace.push(this._buffersPassedToUser[0].status.ready);
      }

      Promise.race(promisesToRace).then(this._loop.bind(this));
      return;
    }
  }
}

class FakeBufferTakingByteSink {
  constructor(readableStream) {
    this._resultPromise = new Promise((resolve, reject) => {
      this._resolveResultPromise = resolve;
      this._rejectResultPromise = reject;
    });

    this._bytesRead = 0;

    if (readableStream === undefined) {
      this._streams = createOperationStream(new AdjustableArrayBufferStrategy());
      this._streams.readable.window = 64;
    } else {
      this._streams = {};
      this._streams.readable = readableStream;
    }

    this._loop();
  }

  get result() {
    return this._resultPromise;
  }

  get stream() {
    return this._streams.writable;
  }

  _loop() {
    const ros = this._streams.readable;

    for (;;) {
      if (ros.state === 'readable') {
        const op = ros.read();
        if (op.type === 'data') {
          const view = op.argument;

          // Verify contents of the buffer.
          for (var i = 0; i < view.byteLength; ++i) {
            if (view[i] === 1) {
              ++this._bytesRead;
            }
          }

          // Release the buffer.
          op.complete();

          continue;
        } else if (op.type === 'close') {
          op.complete();

          this._resolveResultPromise(this._bytesRead);
        } else {
          this._rejectResultPromise(op.type);
        }
      } else if (ros.state === 'waiting') {
        ros.ready.then(this._loop.bind(this)).catch(this._rejectResultPromise.bind(this));
      } else if (ros.state === 'cancelled') {
        this._rejectResultPromise(ros.cancelOperation.argument);
      } else {
        this._rejectResultPromise(ros.state);
      }
      return;
    }
    this._loop();
  }
}

test('Sample implementation of file API with a buffer pool (pipe)', t => {
  const pool = [];
  for (var i = 0; i < 10; ++i) {
    pool.push(new ArrayBuffer(10));
  }

  const bs = new FakeByteSourceWithBufferPool(pool);
  const ros = bs.stream;
  ros.window = 64;

  const sink = new FakeBufferTakingByteSink();
  const wos = sink.stream;

  pipeOperationStreams(ros, wos);

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);

    // Check that the buffers are returned to the pool
    // TODO

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('Sample implementation of file API with a buffer pool (direct writing)', t => {
  const pool = [];
  for (var i = 0; i < 10; ++i) {
    pool.push(new ArrayBuffer(10));
  }

  const bs = new FakeByteSourceWithBufferPool(pool);
  const ros = bs.stream;
  ros.window = 64;

  const sink = new FakeBufferTakingByteSink(ros);

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

class FakeBufferTakingByteSource {
  constructor() {
    const pair = createOperationStream(new AdjustableArrayBufferStrategy());
    this._readableStream = pair.readable;
    this._writableStream = pair.writable;

    this._currentRequest = undefined;

    this._file = new FakeFile();

    this._fileReadStatus = undefined;

    this._readableStream.window = 1;

    this._loop();
  }

  get writableStream() {
    return this._writableStream;
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

      if (this._currentRequest !== undefined && this._fileReadStatus.state !== 'waiting') {
        if (this._fileReadStatus.state === 'errored') {
          const error = this._fileReadStatus.result;
          this._fileReadStatus = undefined

          this._currentRequest.error(error);
          this._currentRequest = undefined;

          rs.cancel(error);

          return;
        }

        this._currentRequest.complete(this._fileReadStatus.result);
        this._currentRequest = undefined;

        this._fileReadStatus = undefined
      }

      if (this._currentRequest === undefined && rs.state === 'readable') {
        this._currentRequest = rs.read();

        this._fileReadStatus = {};
        this._fileReadStatus.state = 'waiting';
        this._fileReadStatus.ready = this._file.readInto(this._currentRequest.argument)
            .then(result => {
              this._fileReadStatus.state = 'completed';
              this._fileReadStatus.result = {closed: result.closed, bytesWritten: result.view.byteLength};
            }).catch(e => {
              this._fileReadStatus.state = 'errored';
              this._fileReadStatus.result = e;
            });

        continue;
      }

      const promisesToRace = [];

      if (rs.state === 'readable') {
        promisesToRace.push(rs.aborted);
      } else if (rs.state === 'waiting') {
        promisesToRace.push(rs.ready);
      }

      if (this._currentRequest !== undefined && this._fileReadStatus.state === 'waiting') {
        promisesToRace.push(this._fileReadStatus.ready);
      }

      Promise.race(promisesToRace)
          .then(this._loop.bind(this))
          .catch(e => rs.cancel.bind(rs, e));
      return;
    }
  }
}

class FakeByteSinkWithBuffer {
  constructor() {
    const pair = createOperationStream(new AdjustableArrayBufferStrategy());
    this._readableStream = pair.readable;
    this._writableStream = pair.writable;

    this._currentReadStatus = undefined;

    this._buffer = new ArrayBuffer(16);

    this._resultPromise = new Promise((resolve, reject) => {
      this._resolveResultPromise = resolve;
      this._rejectResultPromise = reject;
    });
    this._bytesRead = 0;

    this._loop();
  }

  get readableStream() {
    return this._readableStream;
  }

  get result() {
    return this._resultPromise;
  }

  _loop() {
    const ws = this._writableStream;

    for (;;) {
      if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'errored') {
        const error = this._currentReadStatus.result;
        this._currentReadStatus = undefined;

        ws.abort(error);
        this._rejectResultPromise(error);

        return;
      }

      if (ws.state === 'cancelled') {
        this._rejectResultPromise(ws.cancelOperation.argument);
        return;
      }

      let hasProgress = false;

      if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'completed') {
        const bytesWritten = this._currentReadStatus.result.bytesWritten;
        const closed = this._currentReadStatus.result.closed;
        this._currentReadStatus = undefined;

        // Verify contents of the buffer.
        const view = new Uint8Array(this._buffer, 0, bytesWritten);
        for (var i = 0; i < bytesWritten; ++i) {
          if (view[i] === 1) {
            ++this._bytesRead;
          }
        }

        if (closed) {
          this._resolveResultPromise(this._bytesRead);
          return;
        }

        hasProgress = true;
      }

      if (this._currentReadStatus === undefined && ws.state === 'writable') {
        this._currentReadStatus = ws.write(new Uint8Array(this._buffer));

        hasProgress = true;
      }

      if (hasProgress) {
        continue;
      }

      const promisesToRace = [];

      if (ws.state === 'writable') {
        promisesToRace.push(ws.cancelled);
      } else if (ws.state === 'waiting') {
        promisesToRace.push(ws.ready);
      }

      if (this._currentReadStatus !== undefined && this._currentReadStatus.state === 'waiting') {
        promisesToRace.push(this._currentReadStatus.ready);
      }

      Promise.race(promisesToRace)
          .then(this._loop.bind(this))
          .catch(e => this._rejectResultPromise.bind(this, e));
      return;
    }
  }
}

test('Piping from a buffer taking source to a sink with buffer', t => {
  const pool = [];
  for (var i = 0; i < 10; ++i) {
    pool.push(new ArrayBuffer(10));
  }

  const source = new FakeBufferTakingByteSource();
  const ws = source.writableStream;

  const sink = new FakeByteSinkWithBuffer();
  const rs = sink.readableStream;
  rs.window = 16;

  pipeOperationStreams(rs, ws);

  sink.result.then(bytesRead => {
    t.equals(bytesRead, 1024);
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});
