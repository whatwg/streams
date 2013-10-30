# Streams API

## Abstract

The streams API provides an interface for creating, composing, and consuming streams of binary data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with backpressure. They provide an [extensible web](http://extensiblewebmanifesto.org/) primitive which higher-level abstractions can be built upon, such as filesystem or socket APIs.

## Status

This document is currently a brain-dump of some thoughts I had previously stored [in a gist](https://gist.github.com/domenic/0c47ae300608341f3d7f). Don't judge it too harshly yet. I hope to do more work this coming weekend (November 1 through 3). In the meantime, please peruse and comment on the repository's issues.

## Required Background Reading

The most clear and insightful commentary on a streams API has so far been produced by Isaac Schlueter, lead Node.js maintainer. In a series of posts on the public-webapps list, he outlined his thoughts, first [on the general concepts and requirements of a streams API](http://lists.w3.org/Archives/Public/public-webapps/2013JulSep/0275.html), and second [on potential specific API details and considerations](http://lists.w3.org/Archives/Public/public-webapps/2013JulSep/0355.html). This document leans heavily on his conceptual analysis.

To understand the importance of backpressure, watch [Thorsten Lorenz's LXJS 2013 talk](https://www.youtube.com/watch?v=9llfAByho98) and perhaps play with his [stream-viz](http://thlorenz.github.io/stream-viz/) demo.

## Proposed Readable Stream API

This is an immature first pass at a readable stream API. Please peruse the issues list before commenting; I'm aware there's lots of questionable things. Once you've done that though, please comment!

### API Surface

```
class ReadableStream {
  constructor({ ToNumber highWaterMark }, function onRead)
  Promise<ArrayBuffer|undefined> read()
  WritableStream pipe(WritableStream destination)
}
```

(This is written in proto-JSIDL; sorry WebIDL fans. Yes, I know this is not acceptable long-term given that JSIDL isn't written down anywhere. I'll probably switch to ES spec style API definitions instead.)

#### `read`

- Calling `read` returns a promise for an `ArrayBuffer` containing all available bytes in the stream if there are bytes available right now, or waits until bytes are available and then fulfills the promise.
- If there are no bytes left in the stream, the promise is fulfilled with `undefined` instead.

#### `onRead`

- This is called whenever the user calls `.read()`, and is passed three parameters: `push`, `done`, and `error`.
- When data is available, call `push(data)`.
  - If it returns `false`, then nobody wants any more data, and the underlying buffer is full, so you should stop pushing as soon as possible, e.g. by pausing the underlying socket. `onRead` will be called again when someone starts wanting data.
  - The `highWaterMark` value determines when it starts returning `false`, i.e. when the underlying buffer is full. However, the buffer *can* expand indefinitely if you ignore the return value signal and keep pushing data.
  - If `push` returns `true`, then you can keep calling `push` as more data becomes available from the underlying resource.
- Once there is no more data in the underlying resource, call `done()`.
- If at any point an error occurs and you can no longer read any data from the underlying resource, call `error`, preferably with an `Error` instance.

#### `pipe`

- See dedicated pipe section I have yet to write.

### Relation to Isaac's posts

Points taken to heart:

- Drop any idea of "read `n` bytes."
- Reading strings vs. `ArrayBuffer`s vs. anything else *must* be a property of the stream. As such, we only handle binary data for now. *However, our design is sound for any "concatable" resource, so strings work just as well.*

Points where we differ:

- Isaac contends that, if there is already buffered data, waiting until the end of the microtask to consume it is unacceptable. We are not sure this is true; waiting certainly gives a more uniform and less awkward API, and may in practice not come at a cost. This is up for debate. It may be better to add both APIs, with the intent that the higher-level promise-returning `read` method is built on top of the lower-level `poll` + `readBuffer` + `state` primitives Isaac describes.
- Furthermore, promises are the web platform's async primitive, and as of ES6 the language's async primitive as well, so it is not problematic to layer on top of them as it would be in Node and ES5.

### Examples

#### Consuming a Stream

Using ES6 generators and a library like Q or TaskJS to consume promises using `yield`, you get the very nice consumption code:

```js
Q.spawn(function *() {
    const myStream = getTheStream();

    while(let data = yield myStream.read()) {
      console.log(data);
    }
});
```

#### Contrived API Example

This example shows a contrived stream that emits a predetermined sequence of bytes, with one second delay in the middle, just to show how the API works. Since there is no underlying source of data, there is no reasonable way for it to respond to backpressure signals (i.e. there is no TCP socket to pause or such). But it shows the mechanism for how the body of `onRead` interacts with `read`.

```js
// ab2str and str2ab from http://stackoverflow.com/a/11058858/3191

const s = new ReadableStream({ highWaterMark: 1024 }, (push, done, error) => {
    push(str2ab("123"));
    push(str2ab("456"));

    setTimeout(() => {
        push(str2ab("789"));
        done();

        push(str2ab("101112")); // ignored
        error(new Error("whatever")); // ignored
    }, 1000);
});

s.read(); // promise for ArrayBuffer of "123456"
s.read(); // promise for ArrayBuffer of "123456"

s.read().then(val => {
    assert(ab2str(val) === "123456");

    s.read(); // promise for ArrayBuffer of "789"

    s.read().then(val => {
        assert(ab2str(val) === "789");

        s.read(); // promise for `undefined`.
    });
});
```

#### Producing a Stream, no Backpressure

This example adopts an incoming stream of websocket messages to a `ReadableStream`. Since websockets do not expose a method for sending pause messages to the underlying socket, we do not respond to backpressure here.

```js
const socket = new WebSocket("ws://example.com/push-me-data");
socket.binaryType = 'arraybuffer';

const stream = new ReadableStream({ highWaterMark: 1024 }, (push, done, error) => {
    socket.onerror = function (message) {
        error(new Error('WebSocket error: ' + message));
    };

    socket.ondata = function (event) {
        push(event.data);
    };

    socket.onclose = done;
});
```

#### Producing a Stream, with Backpressure

TODO: maybe build an ad-hoc websocket protocol where we tell the server to stop sending via some message.

## Writable Streams

TODO. Mostly copy Node. But don't return a boolean; maybe have a stream state property instead. See related issue.

## Piping Readable Streams to Writable Streams

TODO. Explain pipe and how it does backpressure, preferably by writing it in terms of `read()` and `write()`.
