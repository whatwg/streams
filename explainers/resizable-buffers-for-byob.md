# Resizable buffers for BYOB readers


## Introduction

The streams APIs provide ubiquitous, interoperable primitives for creating, composing, and consuming streams of data.
For streams representing bytes, readable byte streams are an extended version of readable streams which are provided to
handle bytes efficiently. These readable byte streams allow for BYOB (bring-your-own-buffer) readers to be acquired,
where a buffer can be reused for multiple reads to reduce garbage collection and to minimize copies.

This change extends BYOB readers to accept resizable `ArrayBuffer`s, allowing the consumer to adjust the buffer's size
without copying to a new buffer.

## API Proposed

*   [`ReadableStreamBYOBReader.read(view, opts)`](https://streams.spec.whatwg.org/#byob-reader-read)
    and [`ReadableStreamBYOBRequest.respondWithNewView(view)`](https://streams.spec.whatwg.org/#rs-byob-request-respond-with-new-view)
    will also accept an `ArrayBufferView` backed by a resizable `ArrayBuffer`.
    *   The backing buffer will still become detached as usual,
        but now the resizability of that buffer will be preserved when it is returned by the reader.
*   [`ReadableByteStreamController.enqueue(chunk)`](https://streams.spec.whatwg.org/#rbs-controller-enqueue)
    will be left unchanged.

## Examples

### Grow buffer for large read

The code starts out reading into a small buffer of 1024 bytes.
If that is not large enough to hold the entire response, we grow the buffer
so it can hold the additional bytes from subsequent reads.

```javascript
const reader = readableStream.getReader({ mode: "byob" });
const buffer = new ArrayBuffer(1024, { maxByteLength: 8192 });
let offset = 0;
while (true) {
  const { value: view, done } =
    await reader.read(new Uint8Array(buffer, offset, buffer.byteLength - offset));
  buffer = view.buffer;
  offset += view.byteLength;
  if (done) {
    return new Uint8Array(buffer, 0, offset);
  }
  if (offset === buffer.byteLength) {
    // Buffer is full, resize if possible.
    if (buffer.byteLength < buffer.maxByteLength) {
      buffer.resize(buffer.byteLength * 2);
    } else {
      throw new RangeError("Response is too large!");
    }
  }
}
```

### Shrink buffer after reading

The code reads a response that can be up to 1024 bytes long into a single `ArrayBuffer`.
If the response ends up being smaller than 1024 bytes, we resize the buffer to match the exact response size
and free up the unused bytes of that buffer.

```javascript
const MAX_SIZE = 1024;
const reader = readableStream.getReader({ mode: "byob" });
// Create a buffer that can fit a complete response (at most 1024 bytes).
const buffer = new ArrayBuffer(1024, { maxByteLength: 1024 });
// Read the whole response.
const { value: view, done } =
  await reader.read(new Uint8Array(buffer, 0, buffer.byteLength), { min: buffer.byteLength });
buffer = view.buffer;
if (done) {
  // If the response was smaller, shrink the backing buffer *without copying*.
  buffer.resize(view.byteLength);
} else {
  throw new RangeError("Response is too large!");
}
```

## Goals

*   Allow buffers for BYOB to grow or shrink between reads without copying.

## Non-Goals

*   Growable shared array buffers are not part of this proposal.

## End-user Benefits

*   ...

## Alternatives

*   ...
