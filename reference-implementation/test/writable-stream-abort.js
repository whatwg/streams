var test = require('tape');

import WritableStream from '../lib/writable-stream';

test('Aborting a WritableStream immediately prevents future writes', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk) {
      chunks.push(chunk);
    }
  });

  setTimeout(() => {
    ws.abort();
    ws.write(1);
    ws.write(2);
    t.deepEqual(chunks, [], 'no chunks are written');
    t.end();
  }, 0);
});

test('Aborting a WritableStream prevents further writes after any that are in progress', t => {
  var chunks = [];
  var ws = new WritableStream({
    write(chunk) {
      chunks.push(chunk);
      return new Promise(resolve => setTimeout(resolve, 50));
    }
  });

  setTimeout(() => {
    ws.write(1);
    ws.write(2);
    ws.write(3);
    ws.abort();
    ws.write(4);
    ws.write(5);

    setTimeout(function () {
      t.deepEqual(chunks, [1], 'only the single in-progress chunk gets written');
      t.end();
    }, 200);
  }, 0);
});

test(`Fulfillment value of ws.abort() call must be undefined even if the underlying sink returns a
 non-undefined value`, t => {
  var ws = new WritableStream({
    abort() {
      return 'Hello';
    }
  });

  var abortPromise = ws.abort('a');
  abortPromise.then(value => {
    t.equal(value, undefined, 'fulfillment value must be undefined');
    t.end();
  }).catch(() => {
    t.fail('abortPromise is rejected');
    t.end();
  });
});

test('WritableStream if sink\'s abort throws, the promise returned by ws.abort() rejects', t => {
  var errorInSinkAbort = new Error('Sorry, it just wasn\'t meant to be.');
  var ws = new WritableStream({
    abort() {
      throw errorInSinkAbort;
    }
  });

  var abortPromise = ws.abort(undefined);
  abortPromise.then(
    () => {
      t.fail('abortPromise is fulfilled unexpectedly');
      t.end();
    },
    r => {
      t.equal(r, errorInSinkAbort, 'rejection reason of abortPromise must be errorInSinkAbort');
      t.end();
    }
  );
});

test('Aborting a WritableStream passes through the given reason', t => {
  var recordedReason;
  var ws = new WritableStream({
    abort(reason) {
      recordedReason = reason;
    }
  });

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);

  t.equal(recordedReason, passedReason);
  t.end();
});

test('Aborting a WritableStream puts it in an errored state, with stored error equal to the abort reason', t => {
  t.plan(6);

  var recordedReason;
  var ws = new WritableStream();

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);

  t.equal(ws.state, 'errored', 'state should be errored');

  ws.write().then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  ws.wait().then(
    () => t.fail('waiting should not succeed'),
    r => t.equal(r, passedReason, 'waiting should reject with the given reason')
  );

  ws.close().then(
    () => t.fail('closing should not succeed'),
    r => t.equal(r, passedReason, 'closing should reject with the given reason')
  );

  ws.abort().then(
    () => t.fail('aborting a second time should not succeed'),
    r => t.equal(r, passedReason, 'aborting a second time should reject with the given reason')
  );

  ws.closed.then(
    () => t.fail('closed promise should not be fulfilled'),
    r => t.equal(r, passedReason, 'closed promise should be rejected with the given reason')
  );
});

test('Aborting a WritableStream causes any outstanding wait() promises to be rejected with the abort reason', t => {
  t.plan(2);

  var recordedReason;
  var ws = new WritableStream({});
  ws.write('a');
  t.equal(ws.state, 'waiting', 'state should be waiting');

  ws.wait().then(
    () => t.fail('waiting should not succeed'),
    r => t.equal(r, passedReason, 'waiting should reject with the given reason')
  );

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);
});

test('Aborting a WritableStream causes any outstanding write() promises to be rejected with the abort reason', t => {
  t.plan(1);

  var ws = new WritableStream();

  ws.write('a').then(
    () => t.fail('writing should not succeed'),
    r => t.equal(r, passedReason, 'writing should reject with the given reason')
  );

  var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
  ws.abort(passedReason);
});

test('Aborting a WritableStream right after close call whose sink\'s close does nothing asynchronously', t => {
  var closeCount = 0;
  var ws = new WritableStream({
    close() {
      ++closeCount;
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closePromise = ws.close();
    t.equal(closeCount, 1, 'sink\'s close is called synchronously');

    // Now, call abort() after the sink's close is finished.
    var abortPromise = ws.abort();

    t.equal(ws.state, 'closing', 'state must be still closing');

    ws.closed.then(() => {
      t.equal(ws.state, 'closed', 'abort must have been ignored');

      closePromise.then(() => {
        abortPromise.then(() => {
          t.end();
        }).catch(() => {
          t.fail('abortPromise is rejected');
          t.end();
        });
      }).catch(() => {
        t.fail('closePromise is rejected');
        t.end();
      });
    }).catch(() => {
      t.fail('closedPromise is rejected');
      t.end();
    });
  }, 0);
});

test('Aborting a WritableStream right after close call whose sink\'s close throws', t => {
  var closeCount = 0;
  var passedError = new Error('pass me');
  var ws = new WritableStream({
    close() {
      ++closeCount;
      throw passedError;
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closePromise = ws.close();
    t.equal(closeCount, 1, 'sink\'s close is called synchronously');

    // Now, call abort() after the sink's close is finished.
    var abortPromise = ws.abort();

    t.equal(ws.state, 'closing', 'state must be still closing');

    ws.closed.then(
      () => {
        t.fail('closedPromise is fulfilled');
        t.end();
      },
      r => {
        t.equal(ws.state, 'errored', 'stream must be errored');
        t.equal(r, passedError, 'abort must have been ignored');

        closePromise.then(
          () => {
            t.fail('closePromise is fulfilled');
            t.end();
          },
          r => {
            t.equal(r, passedError, 'abort must have been ignored');
            abortPromise.then(
              () => {
                t.fail('abortPromise is fulfilled');
                t.end();
              },
              r => {
                t.equal(r, passedError, 'abort must have been ignored');
                t.end();
              }
            );
          }
        );
      }
    );
  }, 0);
});

test(`Aborting a WritableStream with a sink with close that returns a promise to be fulfilled asynchronously but before
 abort`, t => {
  var resolveClosePromise;
  var ws = new WritableStream({
    close() {
      return new Promise((resolve, reject) => resolveClosePromise = resolve);
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closePromise = ws.close();
    t.notEqual(resolveClosePromise, undefined, 'sink\'s close must have been called');

    resolveClosePromise();

    var abortPromise = ws.abort();
    t.equal(ws.state, 'closing', 'state must be still closing');

    ws.closed.then(() => {
      t.equal(ws.state, 'closed', 'abort must have been ignored');

      closePromise.then(() => {
        abortPromise.then(() => {
          t.end();
        }).catch(() => {
          t.fail('abortPromise is rejected');
          t.end();
        });
      }).catch(() => {
        t.fail('closePromise is rejected');
        t.end();
      });
    }).catch(() => {
      t.fail('closedPromise is rejected');
      t.end();
    });
  }, 0);
});

test('Aborting a WritableStream in closing state whose sink\'s close completes after abort\'s microtask is run', t => {
  var resolveClosePromise;
  var abortCount = 0;
  var sinkAbortReturnValue = 'sink aborted';
  var ws = new WritableStream({
    close() {
      return new Promise((resolve, reject) => resolveClosePromise = resolve);
    },
    abort() {
      ++abortCount;
      return sinkAbortReturnValue;
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closePromise = ws.close();
    t.notEqual(resolveClosePromise, undefined, 'sink\'s close must have been called');

    var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
    var abortPromise = ws.abort(passedReason);
    t.equal(ws.state, 'closing', 'state must be still closing');

    // Delay to run resolveClosePromise() after ws.abort()'s microtask is done.
    Promise.resolve(undefined).then(() => {
      resolveClosePromise();

      t.equal(abortCount, 1);
      t.equal(ws.state, 'errored', 'close operation must have been aborted');
      ws.closed.then(
        () => {
          t.fail('closedPromise is fulfilled');
          t.end();
        },
        r => {
          t.equal(r, passedReason, 'closedPromise must be rejected with the error passed to abort()');

          closePromise.then(
            () => {
              t.fail('closePromise is fulfilled');
              t.end();
            },
            r => {
              t.equal(r, passedReason, 'closePromise must be rejected with the error passed to abort()');

              abortPromise.then(x => {
                t.equal(x, sinkAbortReturnValue,
                        'abortPromise must be fulfilled with the return value of abort() of the sink');
                t.end();
              }).catch(() => {
                t.fail('abortPromise is rejected');
                t.end();
              });
            }
          );
        }
      );
    });
  }, 0);
});

test(`Aborting a WritableStream in closing state whose sink\'s close completes after abort\'s microtask is run. If the
 sink's abort throws`, t => {
  var resolveClosePromise;
  var abortCount = 0;
  var errorInSinkAbort = new Error('sink abort failed');
  var ws = new WritableStream({
    close() {
      return new Promise((resolve, reject) => resolveClosePromise = resolve);
    },
    abort() {
      ++abortCount;
      throw errorInSinkAbort;
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    var closePromise = ws.close();
    t.notEqual(resolveClosePromise, undefined, 'sink\'s close must have been called');

    var passedReason = new Error('Sorry, it just wasn\'t meant to be.');
    var abortPromise = ws.abort(passedReason);
    t.equal(ws.state, 'closing', 'state must be still closing');

    // Delay to run resolveClosePromise() after ws.abort()'s microtask is done.
    Promise.resolve(undefined).then(() => {
      resolveClosePromise();

      t.equal(abortCount, 1);
      t.equal(ws.state, 'errored', 'close operation must have been aborted');
      ws.closed.then(
        () => {
          t.fail('closedPromise is fulfilled');
          t.end();
        },
        r => {
          t.equal(r, passedReason, 'closedPromise must be rejected with the error passed to abort()');

          closePromise.then(
            () => {
              t.fail('closePromise is fulfilled');
              t.end();
            },
            r => {
              t.equal(r, passedReason, 'closePromise must be rejected with the error passed to abort()');

              abortPromise.then(() => {
                t.fail('abortPromise is fulfilled');
                t.end();
              }).catch(r => {
                t.equal(r, errorInSinkAbort,
                        'abortPromise must be rejected with the error thrown in abort() of the sink');
                t.end();
              });
            }
          );
        }
      );
    });
  }, 0);
});

test('Extra abort calls on a WritableStream in closing state must fail', t => {
  var ws = new WritableStream();

  ws.close();
  ws.abort();
  ws.abort().then(
    () => t.fail('Extra abort() is not rejected'),
    r => {
      t.equal(r.constructor, TypeError);
      t.end();
    });
});
