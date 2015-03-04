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
          if (source.state === 'errored') {
            if (dest.state !== 'cancelled') {
              jointOps(source.error, dest.cancel(source.error.argument));
            }
            return;
          }
          if (dest.state === 'errored') {
            if (source.state !== 'aborted') {
              jointOps(dest.error, source.abort(dest.error.argument));
            }
            return;
          }

          if (dest.state === 'writable') {
            if (source.state === 'readable') {
              const op = source.read();
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

          selectStreams(source, dest)
              .then(loop)
              .catch(disposeStreams);
          return;
        }
      }
      loop();
    });
  }

  const pair0 = createOperationQueue(new AdjustableStringStrategy());
  const ws0 = pair0.writable;
  const rs0 = pair0.readable;

  const pair1 = createOperationQueue(new AdjustableStringStrategy());
  const ws1 = pair1.writable;
  const rs1 = pair1.readable;

  byteCountingTransform(rs0, ws1)
      .catch(e => {
        t.fail(e);
        t.end();
      });

  ws0.write('hello');
  ws0.write('world');
  ws0.write('goodbye');
  ws0.close();

  rs1.window = 1;

  rs1.readable.then(() => {
    const v = rs1.read().argument;
    t.equal(v, 17);
    t.end();
  }).catch(e => {
    t.fail(e);
    t.end();
  });
});
