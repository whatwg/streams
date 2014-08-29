import ReadableStream from './readable-stream';
import WritableStream from './writable-stream';

export default class TransformStream {
  constructor({ transform, flush = (enqueue, close) => close(), writableStrategy, readableStrategy }) {
    if (typeof transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    var writeChunk, writeDone, errorWritable;
    var transforming = false;
    var chunkWrittenButNotYetTransformed = false;
    this.writable = new WritableStream({
      start(error) {
        errorWritable = error;
      },
      write(chunk) {
        writeChunk = chunk;
        chunkWrittenButNotYetTransformed = true;

        var p = new Promise(resolve => writeDone = resolve);
        if (readable.state === 'waiting') {
          maybeDoTransform();
        }
        return p;
      },
      close() {
        try {
          flush(enqueueInReadable, closeReadable);
        } catch (e) {
          errorWritable(e);
          errorReadable(e);
        }
      },
      strategy: writableStrategy
    });

    var enqueueInReadable, closeReadable, errorReadable;
    var readable = this.readable = new ReadableStream({
      start(enqueue, close, error) {
        enqueueInReadable = enqueue;
        closeReadable = close;
        errorReadable = error;
      },
      pull() {
        if (chunkWrittenButNotYetTransformed === true) {
          maybeDoTransform();
        }
      },
      strategy: readableStrategy
    });

    function maybeDoTransform() {
      if (transforming === false) {
        transforming = true;
        try {
          transform(writeChunk, enqueueInReadable, transformDone);
        } catch (e) {
          transforming = false;
          errorWritable(e);
          errorReadable(e);
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
