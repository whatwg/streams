import ReadableStream from './readable-stream';
import WritableStream from './writable-stream';

export default class TransformStream {
  constructor({ transform, flush = (enqueue, close) => close() }) {
    if (typeof transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    var enqueueInOutput, closeOutput, errorOutput;
    this.output = new ReadableStream({
      start(enqueue, close, error) {
        enqueueInOutput = enqueue;
        closeOutput = close;
        errorOutput = error;
      }
    });

    this.input = new WritableStream({
      write(chunk, doneProcessingChunk, errorInput) {
        try {
          transform(chunk, enqueueInOutput, doneProcessingChunk);
        } catch (e) {
          errorInput(e);
          errorOutput(e);
        }
      },
      close() {
        flush(enqueueInOutput, closeOutput);
      }
    });
  }
}
