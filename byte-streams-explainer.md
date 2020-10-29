# Byte Streams Explainer


## Introduction

The streams APIs provide ubiquitous, interoperable primitives for creating, composing, and consuming streams of data.
For streams representing bytes, readable byte streams are an extended version of readable streams which are provided to
handle bytes efficiently.

Byte streams allow for BYOB (bring-your-own-buffer) readers to be acquired. The default stream type can give a range of
different outputs, for example strings or array buffers in the case of WebSockets, whereas byte streams guarantee byte
output. Furthermore, being able to have BYOB readers has benefits in terms of stability. This is because if a buffer
detaches, it can guarantee that one does not write into the same buffer twice, hence avoiding race conditions. BYOB
readers can reduce the number of times we run garbage collection, because we can reuse buffers.


## Examples

These are a few examples of Javascript which can be used for byte streams once this is implemented:


### Reading bytes from the stream into a single memory buffer

The code reads the first 1024 bytes from the stream into a single memory buffer. This is due to the fact that if a
stream is a readable byte stream, you can also acquire a BYOB reader for it, which allows more precise control over
buffer allocation in order to avoid copies.


```javascript
const reader = readableStream.getReader({ mode: "byob" });

let startingAB = new ArrayBuffer(1024);
const buffer = await readInto(startingAB);
console.log("The first 1024 bytes: ", buffer);

async function readInto(buffer) {
  let offset = 0;

  while (offset < buffer.byteLength) {
    const {value: view, done} =
     await reader.read(new Uint8Array(buffer, offset, buffer.byteLength - offset));
    buffer = view.buffer;
    if (done) {
      break;
    }
    offset += view.byteLength;
  }

  return buffer;
}
```


Note that after this code has run, `startingAB` is detached and can no longer be used to access the data, but `buffer`
points to the same region of memory.


### A readable byte stream with an underlying pull source

The following function returns readable byte streams that allow efficient zero-copy reading of a randomly generated
array. Instead of using a predetermined chunk size of 1024, it attempts to fill the developer-supplied buffer,
allowing full control.


```javascript
const DEFAULT_CHUNK_SIZE = 1024;

function makeReadableByteStream() {
  return new ReadableStream({
    type: "bytes",

    async pull(controller) {
      // Even when the consumer is using the default reader, the auto-allocation
      // feature allocates a buffer and passes it to us via byobRequest.
      const v = controller.byobRequest.view;
      v = crypto.getRandomValues(v);
      controller.byobRequest.respond(v.byteLength);
    },

    autoAllocateChunkSize: DEFAULT_CHUNK_SIZE
  });
}
```


With this in hand, we can create and use BYOB readers for the returned `ReadableStream`. The adaptation between the
low-level byte tracking of the underlying byte source shown here, and the higher-level chunk-based consumption of
a default reader, is all taken care of automatically by the streams implementation.
