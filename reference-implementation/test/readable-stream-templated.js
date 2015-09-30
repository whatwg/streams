import templatedRSClosed from './templated/readable-stream-closed';
import templatedRSErrored from './templated/readable-stream-errored';
import templatedRSErroredAsyncOnly from './templated/readable-stream-errored-async-only';
import templatedRSTwoChunksClosed from './templated/readable-stream-two-chunks-closed';

templatedRSClosed('ReadableStream (closed via call in start)',
  () => new ReadableStream({
    start(c) { c.close(); }
  })
);

templatedRSClosed('ReadableStream (closed via cancel)',
  () => {
    const stream = new ReadableStream();
    stream.cancel();
    return stream;
  }
);

const theError = new Error('boo!');

templatedRSErrored('ReadableStream (errored via call in start)',
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

const chunks = ['a', 'b'];

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
