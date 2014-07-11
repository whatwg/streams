import ReadableStream from '../../lib/readable-stream';
import WritableStream from '../../lib/writable-stream';

// TODO: an evolved form of this should be part of the standard library. Although before that happens it needs to
// handle aborts/cancels/errors correctly.

export default function duckTypedPassThroughTransform() {
  var enqueueInOutput;
  var closeOutput;

  return {
    input: new WritableStream({
      write(chunk, done, error) {
        enqueueInOutput(chunk);
        done();
      },

      close() {
        closeOutput();
      }
    }),

    output: new ReadableStream({
      start(enqueue, close) {
        enqueueInOutput = enqueue;
        closeOutput = close;
      }
    })
  };
}
