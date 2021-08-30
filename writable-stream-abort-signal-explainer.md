# WritableStream controller AbortSignal Explainer


## Introduction

The streams APIs provide ubiquitous, interoperable primitives for creating, composing, and consuming streams of data.

This change permits an underlying sink to rapidly abort an ongoing write or close when requested by the writer.

Previously, when `writer.abort()` was called, a long-running write would still have to continue to completion before
the stream could be aborted. With this change, the write can be aborted immediately.

An underlying sink which doesn't observe the `controller.signal` will continue to have the existing behavior.

In addition to being exposed to streams authored in JavaScript, this facility will also be used by platform-provided
streams such as [WebTransport](https://w3c.github.io/webtransport/).


## API Proposed

On [WritableStreamDefaultController](https://streams.spec.whatwg.org/#writablestreamdefaultcontroller)
(the controller argument that is passed to underlying sinks):

*   [abortReason](https://streams.spec.whatwg.org/#writablestreamdefaultcontroller-abortreason)
    *   The argument passed to `writable.abort()` or `writer.abort()`. Undefined if no argument was passed or `abort()`
    hasn't been called.
*   [signal](https://streams.spec.whatwg.org/#writablestreamdefaultcontroller-signal)
    *   An AbortSignal. By using `signal.addEventListener('abort', …)` an underlying sink can abort the pending write
    or close operation when the stream is aborted.

The WritableStream API does not change. Instead, the existing `abort()` operation will now signal abort.


## Examples

These are some examples of Javascript which can be used for writable streams once this is implemented:

In this example, the underlying sink write waits 1 second to simulate a long-running operation. However, if abort() is
called it stops immediately.


```javascript
const ws = new WritableStream({
  write(controller) {
    return new Promise((resolve, reject) => {
      setTimeout(resolve, 1000);
      controller.signal.addEventListener('abort',
        () => reject(controller.abortReason()));
    });
  }
});
const writer = ws.getWriter();

writer.write(99);
await writer.abort();
```


This example shows integration with an existing API that uses AbortSignal. In this case, each write() triggers a POST
to a remote endpoint using [the fetch API](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API). The signal is
used to abort the ongoing fetch when the stream is aborted.


```javascript
const endpoint = 'https://endpoint/api';
const ws = new WritableStream({
  async write(controller, chunk) {
    const response = await fetch(endpoint, { signal: controller.signal,
                                             method: 'POST',
                                             body: chunk });
    await response.text();
  }
});
const writer = ws.getWriter();

writer.write('some data');
await writer.abort();
```

This example shows a use case of this feature with WebTransport.

```javascript
const wt = new WebTransport(...);
await wt.ready;
const ws = await wt.createUnidirectionalStream();
// `ws` is a WritableStream.

const reallyBigArrayBuffer = …;
writer.write(reallyBigArrayBuffer);
// Send RESET_STREAM to the server without waiting for `reallyBigArrayBuffer` to
// be transmitted.
await writer.abort();
```



## Goals

*   Allow writes to be aborted more quickly and efficiently.
*   WebTransport will be able to use WritableStreamDefaultController.signal to make
[SendStream's write](https://w3c.github.io/webtransport/#sendstream-write) and
[close](https://w3c.github.io/webtransport/#sendstream-close) abortable.


## Non-Goals

*   Exposing a method to abort individual operations without aborting the stream as a whole. The semantics of this
would be unclear and confusing.


## User Benefits

*   Allows `abort` operation to complete more quickly, which avoids wasted resources for sites that take advantage of it.


## Alternatives

*   It was initially proposed that an `AbortSignal` could be passed to each sink `write()` call. However, since the
abort signal does not need to change between two `write()` calls, it was thought better to just add a `signal` property
on `WritableStreamDefaultController`.
