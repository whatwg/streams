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

  readInto(buffer) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const bytesToWriteThisTime = Math.min(this._bytesToWrite, buffer.byteLength);

          const view = new Uint8Array(buffer, 0, bytesToWriteThisTime);
          for (var i = 0; i < view.byteLength; ++i) {
            view[i] = 1;
          }

          this._bytesToWrite -= bytesToWriteThisTime;

          if (this._bytesToWrite === 0) {
            resolve({closed: true, view});
          } else {
            resolve({closed: false, view});
          }
        } catch (e) {
          reject(e);
        }
      }, 0);
    });
  }
}

class FakeByteSourceWithBufferPool {
  constructor() {
    this._streams = createOperationStream(new AdjustableArrayBufferStrategy());

    this._file = new FakeFile();
    this._fileReadPromise = undefined;

    this._buffersAvailable = [];
    for (var i = 0; i < 10; ++i) {
      this._buffersAvailable.push(new ArrayBuffer(10));
    }

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

        this._fileReadPromise = this._file.readInto(buffer).then(
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

test('Sample implementation of file API with a buffer pool', t => {
  const bs = new FakeByteSourceWithBufferPool();
  const ros = bs.stream;
  ros.window = 64;

  var bytesRead = 0;
  function pump() {
    for (;;) {
      if (ros.state === 'readable') {
        const op = ros.read();
        if (op.type === 'data') {
          const view = op.argument;

          // Verify contents of the buffer.
          for (var i = 0; i < view.byteLength; ++i) {
            if (view[i] === 1) {
              ++bytesRead;
            }
          }

          // Release the buffer.
          op.complete();
        } else if (op.type === 'close') {
          t.equals(bytesRead, 1024);

          t.end()
        } else {
          t.fail('Invalid type: ' + op.type);
          t.end();
        }
      } else if (ros.state === 'waiting') {
        ros.ready.then(pump);
        return;
      } else if (ros.state === 'cancelled') {
        t.fail(ros.cancelOperation.argument);
        t.end();
      } else {
        t.fail('Unexpected state: ' + ros.state);
        t.end();
      }
    }
  }
  pump();
});
