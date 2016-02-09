import ReadableStream from './readable-stream';
import WritableStream from './writable-stream';

export default class TransformStream {
  constructor(transformer) {
    if (transformer.flush === undefined) {
      transformer.flush = (enqueue, close) => close();
    }

    if (typeof transformer.transform !== 'function') {
      throw new TypeError('transform must be a function');
    }

    let resolveWriteChunk, resolvePullRequested, nextTransformCompleted;
    let errorWritable;
    this.writable = new WritableStream({
      start(error) {
        errorWritable = error;
      },
      write(chunk) {
        resolveWriteChunk(chunk);
        return nextTransformCompleted;
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
        resolvePullRequested();
        return nextTransformCompleted;
      }
    }, transformer.readableStrategy);

    // Create promises to be resolved by the invocation of write() and pull()
    // and hook up our transform invocation so that we only transform when we
    // both have something to transform and an explicit pull request from the
    // readable.
    function prepareNextTransform() {
      let haveWriteChunk = new Promise(resolve => {
        resolveWriteChunk = resolve;
      });
      let pullRequested = new Promise(resolve => {
        resolvePullRequested = resolve;
      });
      let readyForTransform  = Promise.all([haveWriteChunk, pullRequested]);
      nextTransformCompleted = readyForTransform.then(([writeChunk]) => {
        return new Promise(resolve => {
          try {
            transformer.transform(writeChunk, enqueueInReadable, () => {
              prepareNextTransform();
              resolve();
            });
          } catch (e) {
            errorWritable(e);
            errorReadable(e);
          }
        });
      });
    }
    prepareNextTransform();
  }
}
