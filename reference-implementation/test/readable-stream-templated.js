import templatedRSEmpty from './templated/readable-stream-empty';
import templatedRSClosed from './templated/readable-stream-closed';
import templatedRSErrored from './templated/readable-stream-errored';
import templatedRSErroredAsyncOnly from './templated/readable-stream-errored-async-only';
import templatedRSErroredSyncOnly from './templated/readable-stream-errored-sync-only';
import templatedRSTwoChunksClosed from './templated/readable-stream-two-chunks-closed';
import templatedRSEmptyReader from './templated/readable-stream-empty-reader';
import templatedRSClosedReader from './templated/readable-stream-closed-reader';
import templatedRSErroredReader from './templated/readable-stream-errored-reader';
import templatedRSTwoChunksOpenReader from './templated/readable-stream-two-chunks-open-reader';
import templatedRSTwoChunksClosedReader from './templated/readable-stream-two-chunks-closed-reader';

templatedRSEmpty('ReadableStream (empty)',
  () => new ReadableStream()
);

templatedRSEmptyReader('ReadableStream (empty) reader',
  () => streamAndDefaultReader(new ReadableStream())
);

templatedRSClosed('ReadableStream (closed via call in start)',
  () => new ReadableStream({
    start(c) { c.close(); }
  })
);

templatedRSClosedReader('ReadableStream (closed via call in start) reader',
  () => {
    let controller;
    const stream = new ReadableStream({
      start(c) {
        controller = c;
      }
    });
    const result = streamAndDefaultReader(stream);
    controller.close();
    return result;
  }
);

templatedRSClosed('ReadableStream (closed via cancel)',
  () => {
    const stream = new ReadableStream();
    stream.cancel();
    return stream;
  }
);

templatedRSClosedReader('ReadableStream (closed via cancel) reader',
  () => {
    const stream = new ReadableStream();
    const result = streamAndDefaultReader(stream);
    result.reader.cancel();
    return result;
  }
);

const theError = new Error('boo!');

templatedRSErrored('ReadableStream (errored via call in start)',
  () => new ReadableStream({
    start(c) { c.error(theError); }
  }),
  theError
);

templatedRSErroredSyncOnly('ReadableStream (errored via call in start)',
  () => new ReadableStream({
    start(c) { c.error(theError); }
  }),
  theError
);

templatedRSErrored('ReadableStream (errored via returning a rejected promise in start)',
  () => new ReadableStream({
    start() { return Promise.reject(theError); }
  }),
  theError
);

templatedRSErroredAsyncOnly('ReadableStream (errored via returning a rejected promise in start) reader',
  () => new ReadableStream({
    start() { return Promise.reject(theError); }
  }),
  theError
);

templatedRSErroredReader('ReadableStream (errored via returning a rejected promise in start) reader',
  () => streamAndDefaultReader(new ReadableStream({
    start() { return Promise.reject(theError); }
  })),
  theError
);

const chunks = ['a', 'b'];

templatedRSTwoChunksOpenReader('ReadableStream (two chunks enqueued, still open) reader',
  () => streamAndDefaultReader(new ReadableStream({
    start(c) {
      c.enqueue(chunks[0]);
      c.enqueue(chunks[1]);
    }
  })),
  chunks
);

templatedRSTwoChunksClosed('ReadableStream (two chunks enqueued, then closed)',
  () => new ReadableStream({
    start(c) {
      c.enqueue(chunks[0]);
      c.enqueue(chunks[1]);
      c.close();
    }
  }),
  chunks
);

templatedRSTwoChunksClosed('ReadableStream (two chunks enqueued async, then closed)',
  () => new ReadableStream({
    start(c) {
      setTimeout(() => c.enqueue(chunks[0]), 10);
      setTimeout(() => c.enqueue(chunks[1]), 20);
      setTimeout(() => c.close(), 30);
    }
  }),
  chunks
);

templatedRSTwoChunksClosed('ReadableStream (two chunks enqueued via pull, then closed)',
  () => {
    let pullCall = 0;

    return new ReadableStream({
      pull(c) {
        if (pullCall >= chunks.length) {
          c.close();
        } else {
          c.enqueue(chunks[pullCall++]);
        }
      }
    });
  },
  chunks
);

templatedRSTwoChunksClosedReader('ReadableStream (two chunks enqueued, then closed) reader',
  () => {
    let doClose;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(chunks[0]);
        c.enqueue(chunks[1]);
        doClose = c.close.bind(c);
      }
    });
    const result = streamAndDefaultReader(stream);
    doClose();
    return result;
  },
  chunks
);

function streamAndDefaultReader(stream) {
  return { stream: stream, reader: stream.getReader() };
}
