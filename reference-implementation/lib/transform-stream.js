import ReadableStream from './readable-stream';
import WritableStream from './writable-stream';

export default class TransformStream {
  constructor({ transform, flush = (enqueue, close) => close(), inputStrategy, outputStrategy }) {
    if (typeof transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    var writeChunk, writeDone, errorInput;
    var transforming = false;
    var chunkWrittenButNotYetTransformed = false;
    this.input = new WritableStream({
      start(error) {
        errorInput = error;
      },
      write(chunk, done, error) {
        writeChunk = chunk;
        writeDone = done;
        chunkWrittenButNotYetTransformed = true;

        if (output.state === 'waiting') {
          maybeDoTransform();
        }
      },
      close() {
        try {
          flush(enqueueInOutput, closeOutput);
        } catch (e) {
          errorInput(e);
          errorOutput(e);
        }
      },
      strategy: inputStrategy
    });

    var enqueueInOutput, closeOutput, errorOutput;
    var output = this.output = new ReadableStream({
      start(enqueue, close, error) {
        enqueueInOutput = enqueue;
        closeOutput = close;
        errorOutput = error;
      },
      pull() {
        if (chunkWrittenButNotYetTransformed === true) {
          maybeDoTransform();
        }
      },
      strategy: outputStrategy
    });

    function maybeDoTransform() {
      if (transforming === false) {
        transforming = true;
        try {
          transform(writeChunk, enqueueInOutput, transformDone);
        } catch (e) {
          transforming = false;
          errorInput(e);
          errorOutput(e);
        }
      }
    }

    function transformDone() {
      transforming = false;
      chunkWrittenButNotYetTransformed = false;
      writeDone();
    }
  }
}
