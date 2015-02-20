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

test('Synchronous write, read and completion of the operation', t => {
  const pair = createOperationStream({
    size() {
      return 1;
    },
    shouldApplyBackpressure(queueSize) {
      return queueSize > 0;
    }
  });
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
  const pair = createOperationStream({
    size() {
      return 1;
    },
    shouldApplyBackpressure(queueSize) {
      return queueSize > 0;
    }
  });
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

class AdjustableStrategy {
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

test('Asynchronous write, read and completion of the operation', t => {
  const pair = createOperationStream(new AdjustableStrategy());
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

test.only('Pipe', t => {
  const pair0 = createOperationStream(new AdjustableStringStrategy());
  const wos0 = pair0.writable;
  const ros0 = pair0.readable;

  const pair1 = createOperationStream(new AdjustableStringStrategy());
  const wos1 = pair1.writable;
  const ros1 = pair1.readable;

  wos0.write('hello');
  wos0.write('world');

  pipeOperationStreams(ros0, wos1);

  t.equals(ros1.state, 'waiting');

  ros1.window = 10;

  t.equals(ros1.state, 'waiting');

  ros1.ready.then(() => {
    t.equals(ros1.state, 'readable');
    const op1 = ros1.read();
    t.equals(op1.argument, 'hello');

    t.equals(ros1.state, 'readable');
    const op2 = ros1.read();
    t.equals(op2.argument, 'world');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('Sample implementation of network API with a buffer pool', t => {
  const pair = createOperationStream(new AdjustableStrategy());
  const wos = pair.writable;
  const ros = pair.readable;

  var bytesRead = 0;
  var readableClosed = false;
  function pump() {
    for (;;) {
      if (ros.state === 'readable') {
        const op = ros.read();
        if (op.type === 'data') {
          const view = op.argument;
          for (var i = 0; i < view.byteLength; ++i) {
            if (view[i] === 1) {
              ++bytesRead;
            }
          }
        } else {
          readableClosed = true;
        }
        op.complete();
      } else if (ros.state === 'waiting') {
        ros.ready.then(pump);
        return;
      }
    }
  }
  pump();

  ros.window = 64;

  new Promise((resolve, reject) => {
    const bufferPool = [];
    for (var i = 0; i < 10; ++i) {
      bufferPool.push(new ArrayBuffer(10));
    }

    var networkReadPromise = undefined;

    const buffersInUse = [];

    var bytesToWrite = 1024;

    function fakeReadFromNetworkLoop() {
      for (;;) {
        if (wos.state === 'cancelled') {
          reject();
          return;
        }

        var hasProgress = false;

        if (buffersInUse.length > 0) {
          const entry = buffersInUse[0];
          const status = entry.status;
          if (status.state === 'completed') {
            buffersInUse.shift();

            if (entry.buffer === undefined) {
              resolve();
              return;
            }

            bufferPool.push(entry.buffer);

            hasProgress = true;
          } else if (status.state === 'errored') {
            reject();
            return;
          }
        }

        if (networkReadPromise === undefined && bufferPool.length > 0 && wos.state === 'writable') {
          const buffer = bufferPool.shift();
          const view = new Uint8Array(buffer);
          for (var i = 0; i < view.byteLength; ++i) {
            view[0] = 0;
          }

          // Fake async network read operation.
          networkReadPromise = new Promise((resolve, reject) => {
            setTimeout(() => {
              const bytesToWriteThisTime = Math.min(bytesToWrite, buffer.byteLength);
              const view = new Uint8Array(buffer, 0, bytesToWriteThisTime);
              for (var i = 0; i < view.byteLength; ++i) {
                view[i] = 1;
              }
              bytesToWrite -= bytesToWriteThisTime;
              if (bytesToWrite === 0) {
                resolve({close: true, view});
              } else {
                resolve({close: false, view});
              }
            }, 0);
          }).then(result => {
            networkReadPromise = undefined;
            if (result.close) {
              buffersInUse.push({buffer, status: wos.write(result.view)});
              buffersInUse.push({buffer: undefined, status: wos.close()});
            } else {
              buffersInUse.push({buffer, status: wos.write(result.view)});
            }
          });

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

        if (networkReadPromise !== undefined) {
          promisesToRace.push(networkReadPromise);
        }

        if (buffersInUse.length > 0) {
          promisesToRace.push(buffersInUse[0].status.ready);
        }

        Promise.race(promisesToRace).then(fakeReadFromNetworkLoop);
        return;
      }
    }
    fakeReadFromNetworkLoop();
  }).then(
      () => {
        t.equals(bytesRead, 1024);
        t.equals(readableClosed, true);
        t.end()
      }, e => {
        t.fail(e);
        t.end();
      });
});
