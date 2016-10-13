'use strict';
const test = require('tape-catch');

test('If close is called on a WritableStream in writable state, ready will return a fulfilled promise', t => {
  const ws = new WritableStream({
    write() {
      t.fail('Unexpected write call');
      t.end();
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    writer.ready.then(() => {
      t.equal(writer.desiredSize, 1, 'desiredSize should be 1');

      writer.close();
      t.equal(writer.desiredSize, 1, 'desiredSize should be still 1');

      writer.ready.then(v => {
        t.equal(v, undefined, 'ready promise was fulfilled with undefined');
        t.end();
      });
    });
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready promise will fulfill', t => {
  const ws = new WritableStream({
    write() {
      return new Promise(() => {});
    },
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    }
  });

  const writer = ws.getWriter();

  // Wait for ws to start.
  setTimeout(() => {
    writer.write('a');

    t.equal(writer.desiredSize, 0, 'desiredSize should be 0');

    let closeCalled = false;

    writer.ready.then(v => {
      if (closeCalled === false) {
        t.fail('ready fulfilled before writer.close()');
        t.end();
        return;
      }

      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });

    setTimeout(() => {
      writer.close();
      closeCalled = true;
    }, 100);
  }, 0);
});

test('If close is called on a WritableStream in waiting state, ready will be fulfilled immediately even if close ' +
     'takes a long time', t => {
  let readyFulfilledAlready = false;
  const ws = new WritableStream({
    abort() {
      t.fail('Unexpected abort call');
      t.end();
    },
    close() {
      return new Promise(resolve => {
        setTimeout(() => {
          t.ok(readyFulfilledAlready, 'ready should have fulfilled already');
          resolve();
        }, 50);
      });
    }
  });

  // Wait for ws to start.
  setTimeout(() => {
    const writer = ws.getWriter();

    writer.write('a');

    writer.close();

    writer.ready.then(v => {
      readyFulfilledAlready = true;
      t.equal(v, undefined, 'ready promise was fulfilled with undefined');
      t.end();
    });
  }, 0);
});
