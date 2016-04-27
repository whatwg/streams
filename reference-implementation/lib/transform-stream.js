'use strict';
const { ReadableStream } = require('./readable-stream.js');
const { WritableStream } = require('./writable-stream.js');

module.exports = class TransformStream {
  constructor(transformer) {
    if (transformer.flush === undefined) {
      transformer.flush = (enqueue, close) => close();
    }

    if (typeof transformer.transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    let writeChunk, writeDone, errorWritable;
    let transforming = false;
    let chunkWrittenButNotYetTransformed = false;
    this.writable = new WritableStream({
      start(error) {
        errorWritable = error;
      },
      write(chunk) {
        writeChunk = chunk;
        chunkWrittenButNotYetTransformed = true;

        const p = new Promise(resolve => writeDone = resolve);
        maybeDoTransform();
        return p;
      },
      close() {
        try {
          transformer.flush(enqueueInReadable, closeReadable);
        } catch (e) {
          errorWritable(e);
          errorReadable(e);
        }
      }
    }, transformer.writableStrategy);

    let enqueueInReadable, closeReadable, errorReadable;
    this.readable = new ReadableStream({
      start(c) {
        enqueueInReadable = c.enqueue.bind(c);
        closeReadable = c.close.bind(c);
        errorReadable = c.error.bind(c);
      },
      pull() {
        if (chunkWrittenButNotYetTransformed === true) {
          maybeDoTransform();
        }
      }
    }, transformer.readableStrategy);

    function maybeDoTransform() {
      if (transforming === false) {
        transforming = true;
        try {
          transformer.transform(writeChunk, enqueueInReadable, transformDone);
          writeChunk = undefined;
          chunkWrittenButNotYetTransformed = false;
        } catch (e) {
          transforming = false;
          errorWritable(e);
          errorReadable(e);
        }
      }
    }

    function transformDone() {
      transforming = false;
      writeDone();
    }
  }
};
