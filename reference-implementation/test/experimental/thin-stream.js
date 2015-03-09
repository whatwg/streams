const test = require('tape-catch');

import { selectStreams, pipeStreams } from '../../lib/experimental/thin-stream-base';
import { createStreamQueue } from '../../lib/experimental/stream-queue';
import { FakeFile } from '../../lib/experimental/fake-file-backed-byte-source';
import { MockFile } from '../../lib/experimental/mock-byte-sink';

test('Stream queue is constructed', t => {
  const pair = createStreamQueue({
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

test('Synchronous write and read', t => {
  const pair = createStreamQueue(new ApplyBackpressureWhenNonEmptyStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  t.equals(ws.state, 'writable');
  t.equals(rs.state, 'waiting');

  ws.write('hello');

  t.equal(ws.state, 'waiting');
  t.equal(rs.state, 'readable');

  const v = rs.read();
  t.equal(v, 'hello');

  t.equal(ws.state, 'writable');
  t.equal(rs.state, 'waiting');

  t.end();
});

test('Asynchronous read', t => {
  const pair = createStreamQueue(new ApplyBackpressureWhenNonEmptyStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  t.equal(rs.state, 'waiting');

  rs.ready.then(() => {
    t.equal(rs.state, 'readable');

    const v = rs.read();
    t.equal(v, 'hello');

    t.equal(rs.state, 'waiting');

    t.end();
  }, e => {
    t.fail(e);
    t.end();
  });

  t.equal(ws.state, 'writable');

  ws.write('hello');

  t.equal(ws.state, 'waiting');
});

test('Controlling strategy via window setter', t => {
  const pair = createStreamQueue(new AdjustableArrayBufferStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  t.equals(ws.state, 'waiting');

  rs.window = 5;
  t.equal(ws.state, 'writable');
  t.equal(ws.space, 5);

  rs.window = 0;
  ws.write(new ArrayBuffer(10));

  t.equal(ws.state, 'waiting');
  t.equal(ws.space, 0);

  rs.window = 10;
  t.equal(ws.state, 'waiting');
  t.equal(ws.space, 0);

  rs.window = 15;
  t.equal(ws.state, 'writable');
  t.equal(ws.space, 5);

  rs.window = 20;
  t.equal(ws.state, 'writable');
  t.equal(ws.space, 10);

  rs.read();

  t.equal(ws.state, 'writable');
  t.equal(ws.space, 20);

  t.end();
});

test('close()', t => {
  const pair = createStreamQueue(new AdjustableArrayBufferStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  ws.write(new ArrayBuffer(10));
  ws.close();
  t.equal(ws.state, 'closed');

  t.equal(rs.state, 'readable');
  const v0 = rs.read();
  t.equal(rs.state, 'closed');

  t.end();
});

test('abort()', t => {
  const pair = createStreamQueue(new AdjustableStringStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  ws.write('hello');
  ws.write('world');

  const testError = new TypeError('foo');

  rs.errored.then(() => {
    t.equal(rs.state, 'errored', 'rs.state');
    t.equal(rs.error, testError, 'rs.error');

    t.end();
  });

  ws.abort(testError);
  t.equal(ws.state, 'aborted', 'ws.state');
});

test('cancel()', t => {
  const pair = createStreamQueue(new AdjustableStringStrategy());
  const ws = pair.writable;
  const rs = pair.readable;

  ws.write('hello');
  ws.write('world');

  const testError = new TypeError('foo');

  rs.cancel(testError);
  t.equal(rs.state, 'cancelled', 'rs.state');

  ws.errored.then(() => {
    t.equal(ws.state, 'errored', 'ws.state');
    t.equal(ws.error, testError, 'ws.error');

    t.end();
  });
});

test('pipeStreams()', t => {
  const pair0 = createStreamQueue(new AdjustableStringStrategy());
  const ws0 = pair0.writable;
  const rs0 = pair0.readable;

  const pair1 = createStreamQueue(new AdjustableStringStrategy());
  const ws1 = pair1.writable;
  const rs1 = pair1.readable;

  t.equal(ws0.state, 'waiting');
  // Check that ws0 becomes writable.
  ws0.ready.then(() => {
    t.equals(ws0.state, 'writable');

    ws0.write('hello');

    // Just write without state check.
    ws0.write('world');
    ws0.close();
  });

  pipeStreams(rs0, ws1)
      .catch(e => {
        t.fail(e);
        t.end();
      });

  t.equal(rs1.state, 'waiting');

  rs1.window = 20;

  t.equal(rs1.state, 'waiting');

  rs1.ready.then(() => {
    t.equals(rs1.state, 'readable');
    const v0 = rs1.read();
    t.equal(v0, 'hello');

    t.equal(rs1.state, 'readable');
    const v1 = rs1.read();
    t.equal(v1, 'world');

    t.equal(rs1.state, 'closed');

    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});

test('pipeStreams(): abort() propagation', t => {
  t.plan(3);

  const pair0 = createStreamQueue(new AdjustableStringStrategy());
  const ws0 = pair0.writable;
  const rs0 = pair0.readable;

  const pair1 = createStreamQueue(new AdjustableStringStrategy());
  const ws1 = pair1.writable;
  const rs1 = pair1.readable;

  ws0.write('hello');
  ws0.write('world');

  const testError = new TypeError('foo');

  const pipePromise = pipeStreams(rs0, ws1);
  pipePromise
      .then(
          v => t.fail('pipePromise is fulfilled with ' + v),
          e => t.equal(e.message, 'source is errored', 'rejection reason of pipePromise'));

  rs1.errored.then(() => {
    t.equal(rs1.state, 'errored', 'rs.state');
    t.equal(rs1.error, testError, 'rs1.error');
  });

  ws0.abort(testError);
});

test('pipeStreams(): cancel() propagation', t => {
  t.plan(3);

  const pair0 = createStreamQueue(new AdjustableStringStrategy());
  const ws0 = pair0.writable;
  const rs0 = pair0.readable;

  const pair1 = createStreamQueue(new AdjustableStringStrategy());
  const ws1 = pair1.writable;
  const rs1 = pair1.readable;

  ws0.write('hello');
  ws0.write('world');

  const testError = new TypeError('foo');

  const pipePromise = pipeStreams(rs0, ws1);
  pipePromise
      .then(
          v => t.fail('pipePromise is fulfilled with ' + v),
          e => t.equal(e.message, 'dest is errored', 'rejection reason of pipePromise'));

  ws0.errored.then(() => {
    t.equal(ws0.state, 'errored', 'ws0.state');
    t.equal(ws0.error, testError, 'ws0.error');
  });

  rs1.cancel(testError);
});

test('Reading from a file backed byte source using manual pull readable stream', t => {
  const file = new FakeFile(1024);
  const rs = file.createManualPullStream();

  let view = new Uint8Array(10);

  let count = 0;
  function pump() {
    for (;;) {
      if (rs.state === 'errored') {

      } else if (rs.state === 'closed') {
        t.equal(count, 1024);
        t.end();
        return;
      } else if (rs.state === 'readable') {
        const readView = rs.read();
        count += readView.byteLength;
        view = new Uint8Array(readView.buffer);
      } else if (rs.state === 'waiting') {
        if (view !== undefined && rs.pullable) {
          rs.pull(view);
          view = undefined;
          continue;
        }

        const promises = [rs.ready, rs.errored];
        if (!rs.pullable) {
          promises.push(rs.pullReady);
        }
        Promise.race(promises).then(pump);
        return;
      }
    }
  }
  pump();
});

test('Reading from a file backed byte source using auto pull readable stream', t => {
  const file = new FakeFile(1024);
  const rs = file.createStream(new AdjustableArrayBufferStrategy());
  rs.window = 64;

  let count = 0;
  function pump() {
    for (;;) {
      if (rs.state === 'errored') {
        t.fail('rs is errored');
        t.end();
        return;
      } else if (rs.state === 'closed') {
        t.equal(count, 1024);
        t.end();
        return;
      } else if (rs.state === 'readable') {
        const readView = rs.read();
        count += readView.byteLength;
      } else if (rs.state === 'waiting') {
        Promise.race([rs.ready, rs.errored]).then(pump);
        return;
      } else {
        t.fail('rs.state is invalid: ' + rs.state);
        t.end();
        return;
      }
    }
  }
  pump();
});

test('Writing to a mock byte sink using auto disposing writable stream', t => {
  const file = new MockFile();

  const ws = file.createStream();

  ws.write(new Uint8Array(10));
  ws.close();

  file.result.then(bytesRead => {
    t.equal(bytesRead, 10);
    t.end();
  });
});
