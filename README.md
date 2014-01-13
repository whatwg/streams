# Streams API

## Abstract

The streams API provides an interface for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and buffering. They provide an [extensible web](http://extensiblewebmanifesto.org/) toolbox upon which higher-level abstractions can be built, such as filesystem or socket APIs, while at the same time users can use the supplied tools to build their own streaming abstractions.

Both low-level generic streams, with customizable buffering strategy, and high-level binary and string streams, with high water marks providing a built-in buffering strategy, are described. The latter is of course built on top of the former.

## Status

This specification is still a work in progress, but the major ideas are now there. We have a solid [requirements document](Requirements.md), which show what a useful stream API must solve. The most important APIs, for readable and writable streams, are present, with their internal state machines fully fleshed out. Additional APIs for multi-destiniation pipe and differing backpressure strategies are also included.

There is still work to be done, however. Some more helper APIs are necessary to provide a good foundation for streams on the web platform, and although most of them are outlined, they have not all been fleshed out. And the spec certainly needs some polish to make it more pleasant to read and tie everything together.

Please join us in the [issue tracker](https://github.com/whatwg/streams/issues) to help pin down and complete the remaining tasks!

## Requirements

The JavaScript community has extensive experience with streaming primitives, which helps inform what is required for a useful streaming API. These requirements have been gathered and explained in [an accompanying requirements document](Requirements.md). We summarize them here:

- Creating Readable Streams
    - You must be able to efficiently adapt existing _push_-based data sources into a uniform streaming interface.
    - You must be able to efficiently adapt existing _pull_-based data sources into a uniform streaming interface.
    - You must not lose data.
    - You must not force an asynchronous reading API upon users.
- Creating Writable Streams
    - You must shield the user from the complexity of buffering sequential writes.
    - You must not force an asynchronous writing API upon users.
    - You must provide a means of performing batch writes without introducing lag in the normal case.
    - You must provide a way to signal a close of the underlying resource.
- Composing Streams
    - You must be able to pipe streams to each other.
    - You must be able to transform streams via the pipe chain.
    - You must be able to communicate backpressure.
    - You must be able to pipe a stream to more than one writable stream.
    - You must be able to communicate "abort" signals up a pipe chain.
    - You must be able to communicate "dispose" signals down a pipe chain.
- Other
    - The stream API should be agnostic to what type of data is being streamed.
    - You must be able to create representions of "duplex" data sources.
    - You must have a simple way to determine when a stream is "over".
    - You must have a way of passively watching data pass through a stream.

These requirements guide the choices made when shaping the API, so it is very helpful to review them when trying to understand the API presented here.

## Stream APIs Overview

### The Streams Toolbox

In extensible web fashion, we will build up to a fully-featured streams from a few basic primitives:

#### Readable Streams

- `BaseReadableStream`
    - Has a very simple backpressure strategy, communicating to the underlying data source that it should stop supplying data immediately after it pushes some onto the stream's underlying buffer. In other words, it has a high water mark of zero.
    - Support piping to only one destination.
- `ReadableStream`
    - A higher-level API used by most creators of readable streams.
    - Adds the ability to customize the buffering and backpressure strategy, overriding the basic one.
    - Supports piping to more than one destination, by using the `TeeStream` transform stream within its `pipe` method.

#### WritableStreams

- `BaseWritableStream`
    - Has a very simple backpressure strategy, communicating that it is "full" immediately after any data is written (but becoming ready to write again after the asynchronous write completes). In other words, it has a high water mark of zero.
- `WritableStream`
    - A higher-level API used by most creators of writable streams.
    - Adds the ability to customize the buffering and backpressure strategy, overriding the basic one.
- `CorkableWritableStream`
    - Is provided upon creation with a way to write a batch of data at once.
    - Adds the ability to `cork()` and `uncork()` the stream; while the stream is corked, no data is actually written until it is uncorked, at which time a batch-write is performed.

#### Helpers

- `TeeStream`
    - A writable stream, created from two writable streams, such that writing to it writes to the two destination streams.
- `LengthBufferingStrategy`
    - A buffering strategy that uses the `length` property of incoming objects to compute how they contribute to reaching the designated high water mark.
    - Useful mostly for streams of `ArrayBuffer`s and strings.
- `CountBufferingStrategy`
    - A buffering strategy that assumes each incoming object contributes the same amount to reaching the designated high water mark.
    - Useful for streams of objects.
- `ReadableStreamWatcher`
   - An `EventTarget` (or similar?) which taps into a given readable stream and emit `"data"`, `"error"`, and `"finished"` events for those which wish to watch its progress.
   - This could be implemented entirely in user-land, but is provided to solve a common use case.
- `WritableStreamWatcher`
   - Same thing as `ReadableStreamWatcher`, but for writable streams, with `"data"`, `"error"`, `"close"`.

### A Note on Conventions

The interfaces here are specified in a very loose definition language. This language is meant to invoke ECMAScript semantics and to ensure nobody interprets these APIs as conforming to WebIDL conventions, since formalization of this specification will use ECMAScript semantics instead of WebIDL ones. For example, parameters will not be type-validated, but simply used; if they don't implement the appropriate interface, using them will cause errors to be thrown appropriately. This will allow e.g. piping to ad-hoc user-constructed writable streams consisting of object literals with a few specific methods, or better subclassing, or application of generic methods to user-constructed streams.

In other words, over time the definitions given below will disappear, replaced with interface definitions as in the ECMAScript spec (see [Map](http://people.mozilla.org/%7Ejorendorff/es6-draft.html#sec-properties-of-the-map-prototype-object) and [Promise](https://github.com/domenic/promises-unwrapping#properties-of-the-promise-prototype-object)). So don't worry too much about the dialect it's written in, except insofar as it should help or hinder understanding.

## Readable Streams

The *readable stream* abstraction represents a *source* of data, from which you can read. In other words, data comes *out* of a readable stream. At the lower level of the I/O sources which readable streams abstract, there are generally two types of sources: *push sources* and *pull sources*. The readable stream APIs presented here are designed to allow wrapping of both types of sources behind a single, unified interface.

A push source, e.g. a TCP socket, will push data at you; this is somewhat comparable to the higher-level event emitter abstraction. It may also provide a mechanism for pausing and resuming the flow of data (in the TCP socket example, by changing the TCP window size). The process of communicating this pause signal to the source, when more data is being pushed than the ultimate consumer can handle, is called *backpressure*. Backpressure can propagate through a piped-together chain of streams: that is, if the ultimate consumer chooses not to read from the final readable stream in the chain, then the mechanisms of the stream API will propagate this backward through the chain to the original source readable stream, which then sends the pause signal to the push source.

A pull source, e.g. a file handle, requires you to request data from it. The data may be available synchronously (e.g. held in OS memory buffers), or asynchronously. Pull sources are generally simpler to work with, as backpressure is achieved almost automatically. In a piped-together chain of streams where the original readable stream wraps a pull source, read requests are propagated from the ultimate consumer's read of the final readable stream in the chain, all the way back to the original source readable stream.

A final consideration when dealing with readable streams is the *buffering strategy*, which is closely related to how backpressure is handled. First, we note that for push sources, a stream must maintain an internal buffer of data that has been pushed from the source but not yet read out of the stream. The most naive strategy is, once this buffer becomes nonempty, to attempt to pause the underlying source—and once it is drained, to resume the flow of data. Similarly, we consider pull sources: the most naive strategy does not employ a buffer, but simply pulls from the source whenever the stream is read from. It is exactly these naive buffering strategies that are implemented by the `BaseReadableStream` API, which is a lower-level building block designed to wrap pull and push sources into a uniform API. The higher-level `ReadableStream` API allows the implementation of more complex buffering strategies, based on *high water marks*. For readable streams wrapping push sources, a high water mark denotes the level to which the buffer is allowed to fill before trying to pause the push source: this allows the accumulation of some incoming data in memory without impeding the flow from the source, so that it can be flushed through the system more quickly when the consumer is ready to read from the stream. For readable streams wrapping pull sources, a high water mark denotes how much data should be "proactively" pulled into a buffer, even before that data is read out of the stream; this allows larger pulls from the source.

Together, these considerations form the foundation of our readable streams API. It is designed to allow wrapping of both pull and push sources into a single `ReadableStream` abstraction. To accomplish this, the API uses the *revealing constructor pattern*, pioneered by the promises specification (TODO: link to blog post). The constructor of a given stream instance is supplied with two functions, `start` and `pull`, which each are given the parameters `(push, finish, error)` representing capabilities tied to the internals of the stream. (Typically, streams wrapping push sources will put most of their logic in `start`, while those wrapping pull sources will put most of their logic in `pull`.) By mediating all access to the internal state machine through these three functions, the stream's internal state and bookkeeping can be kept private, allowing nobody but the original producer of the stream to insert data into it.

### Examples: Using the `ReadableStream` constructor

To illustrate what we mean by this constructor pattern, consider the following examples.

#### Adapting a Push-Based Data Source

In general, a push-based data source can be modeled as:

- A `readStart` method that starts the flow of data
- A `readStop` method that sends an advisory signal to stop the flow of data
- A `ondata` handler that fires when new data is pushed from the source
- A `onend` handler that fires when the source has no more data
- A `onerror` handler that fires when the source signals an error getting data

As an aside, this is pretty close to the existing HTML [`WebSocket` interface](http://www.whatwg.org/specs/web-apps/current-work/multipage/network.html#the-websocket-interface), with the exception that `WebSocket` does not give any method of pausing or resuming the flow of data.

Let's assume we have some raw C++ socket object or similar, which presents the above API. This is a simplified version of how you could create a `ReadableStream` wrapping this raw socket object. (For a more complete version, see [the examples document][Examples.md].)

```js
function makeStreamingSocket(host, port) {
    const rawSocket = createRawSocketObject(host, port);

    return new ReadableStream({
        start(push, finish, error) {
            rawSocket.ondata = chunk => {
                if (!push(chunk)) {
                    rawSocket.readStop();
                }
            };

            rawSocket.onend = finish;

            rawSocket.onerror = error;
        },

        pull() {
            rawSocket.readStart();
        }
    });
}

var socket = makeStreamingSocket("http://example.com", 80);
```

Here we see a pattern very typical of readable streams that wrap push sources: they do most of their work in the `start` constructor parameter. There, it sets up listeners to call `push` with any incoming data; to call `finish` if the source has no more data; and to call `error` if the source errors. These three functions—`push`, `finish`, and `error`—are given to the supplied `start` parameter, allowing `start` to push onto the internal buffer and otherwise manipulate internal state. `start` is called immediately upon creation of the readable stream, so you can be sure that these listeners were attached immediately after the `rawSocket` object was created.

Note how the `ondata` handler checks the return value of the `push` function, and if it's falsy, it tries to stop the flow of data from the raw socket. `push` returns a boolean that is `true` only if the stream's internal buffer has not yet been filled. If the return value is instead `false`, that means the buffer is full: a backpressure signal. Thus we call `rawSocket.readStop()` to propagate this backpressure signal to the underlying socket.

Finally, we come to the `pull` constructor parameter. `pull` is called whenever the stream's internal buffer has been emptied, but the consumer still wants more data. In this case of a push source, the correct action is to ensure that data is flowing from the raw socket, in case it had been previously paused.

#### Adapting a Pull-Based Data Source

In general, a pull-based data source can be modeled as:

- An `open(cb)` method that gains access to the source; it can call `cb` either synchronous or asynchronously, with either `(err)` or `(null)`.
- A `read(cb)` function method that gets data from the source; can call `cb` either synchronously or asynchronously, with either `(err, null, null)` indicating an error, or `(null, true, null)` indicating there is no more data, or `(null, false, data)` indicating there is data.
- A `close(cb)` method that releases access to the source; can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.

Let's assume that we have some raw C++ file handle API matching this type of setup. This is a simplified version of how you could create a `ReadableStream` wrapping this raw file handle object. (Again, see the examples document for more.)

```js
function makeStreamingFile(filename) {
    const fileHandle = createRawFileHandle(filename);

    return new ReadableStream({
        start() {
            return new Promise((resolve, reject) => {
                fileHandle.open(err => {
                    if (err) {
                        reject(err);
                    }
                    resolve();
                });
            });
        },

        pull(push, finish, error) {
            fileHandle.read((err, done, data) => {
                if (err) {
                    error(err);
                } else if (done) {
                    fileHandle.close(err => {
                        if (err) {
                            error(err);
                        }
                        finish();
                    });
                } else {
                    push(data);
                }
            });
        }
    });
}

var file = makeStreamingFile("/example/path/on/fs.txt");
```

Here we see that the tables are reversed, and the most interesting work is done in the `pull` constructor parameter. `start` simply returns a new promise which is fulfilled if the file handle opens successfully, or is rejected if there is an error doing so. Whereas `pull` proxies requests for more data to the underlying file handle, using the `push`, `finish`, and `error` functions to manipulate the stream's internal buffer and state.

### Examples: Consuming a Readable Stream

In the previous section, we discussed how to create readable streams wrapping arbitrary data sources. The beauty of this approach is that, once you have such a readable stream, you can interface with it using the same simple API, no matter where it came from—and all the low-level concerns like buffering, backpressure, or what type of data source you're dealing with are abstracted away.

#### Using `pipe`

The primary means of consuming a readable stream is through its `pipe` method, which accepts a writable stream, and manages the complex dance required for writing data to the writable stream only as fast as it can accept. The writable stream's  rate of intake is used to govern how fast data is read from the readable stream, thus taking care of the propagation of backpressure signals. A typical pipe scenario might look like:

```js
readableStream.pipe(writeableStream).closed
    .then(() => console.log("All written!"))
    .catch(err => console.error("Something went wrong!", err));
```

90% of the time, this is all that will be required: you will rarely, if ever, have to read from a readable stream yourself. Simply piping to a writable stream, and letting the `pipe` algorithm take care of all the associated complexity, is often enough.

#### Using `read()`/`waitForReadable()`/`readableState`

For those times when you do need to consume a readable stream directly, the usual pattern is to pump it, alternating between using the `read()` and `waitForReadable()` methods by consulting its `readableState` property. For example, this function writes the contents of a readable stream to the console as fast as it can.

```js
function streamToConsole(readableStream) {
    pump();

    function pump() {
        while (readableStream.readableState === "readable") {
            console.log(readableStream.read());
        }

        if (readableStream.readableState === "finished") {
            console.log("--- all done!");
        } else {
            // If we're in an error state, the returned promise will be rejected with that error,
            // so no need to handle "waiting" vs. "errored" separately.
            readableStream.waitForReadable().then(pump, e => console.error(e));
        }
    }
}
```

This function essentially handles each possible state of the stream separately. If the stream is in the `"waiting"` state, meaning there's no data available yet, we call `readableStream.waitForReadable()` to get a promise that will be fulfilled when data becomes available. (This has the side effect of signaling to the stream that we are ready for data, which the stream might use to resume the flow from any underlying data sources.)

Once data is available, the stream transitions to the `"readable"` state. We use a `while` loop to continue to read chunks of data for as long as they are still available; typically this will only be a few iterations. (Sometimes people get confused at this point, thinking that this is a kind of blocking polling loop; it is not. It simply makes sure to empty the internal buffer of all available chunks.) Note that `readableStream.read()` synchronously returns the available data to us from the stream's internal buffer. This is especially important since often the OS is able to supply us with data synchronously; a synchronous `read` method thus gives the best possible performance.

Once all the available data is read from the stream's internal buffer, the stream can go back to `"waiting"`, as more data is retrieved from the underlying source. The stream will alternate between `"waiting"` and `"readable"` until at some point it transitions to either `"finished"` or `"errored"` states. In either of those cases, we log the event to the console, and are done!

### Other APIs on Readable Streams

Besides the constructor pattern, the `pipe` method for piping a readable stream into a writable stream, and the `read()`/`waitForReadable()`/`readableState` primitives for reading raw data, a readable stream provides two more APIs: `finished` and abort(reason)`.

`finished` is a simple convenience API: it's a promise that becomes fulfilled when the stream has been completely read (`readableState` of `"finished"`), or becomes rejected if some error occurs in the stream (`readableState` of `"error"`).

The abort API is a bit more subtle. It allows consumers to communicate a *loss of interest* in the stream's data; you could use this, for example, to abort a file download if the user clicks "Cancel." The main functionality of abort is handled by another constructor parameter, alongside `start` and `pull`: for example, we might extend our above socket stream with an `abort` parameter like so:

```js
return new ReadableStream({
    start(push, finish, error) { /* as before */ },
    pull() { /* as before */ }
    abort() {
        rawSocket.readStop();
        rawSocket = null;
    }
});
```

In addition to calling the `abort` functionality given in the stream's constructor, a readable stream's `abort(reason)` method cleans up the stream's internal buffer and ensures that the `pull` constructor parameter is never called again. It Puts the stream in the `"finished"` state—aborting is not considered an error—but any further attempts to `read()` will result in `reason` being thrown, and attempts to call `waitForReadable()` will give a promise rejected with `reason`.

### The Readable Stream State Diagram

As you've probably gathered from the above explanations, readable streams have a fairly complex internal state machine, which is responsible for keeping track of the internal buffer, and initiating appropriate actions in response to calls to a stream's methods. This can be roughly summarized in the following diagram:

![A state machine diagram of a readable stream, showing transitions between waiting (starting = true), waiting (starting = false), readable (draining = false), readable (draining = true), finished, and errored states.](https://rawgithub.com/whatwg/streams/master/readable-stream.svg)

Here we denote methods of the stream called by external consumers `in monospace`; constructor methods **in bold**, and capabilities handed to constructor methods *in italic*.

### Readable Stream APIs

Without further adieu, we describe the `BaseReadableStream` and `ReadableStream` APIs, including the internal algorithms they use to manage the stream state and buffer.

#### BaseReadableStream

```
class BaseReadableStream {
    constructor({
        function start = () => {},
        function pull = () => {},
        function abort = () => {}
    })

    // Reading data from the underlying source
    any read()
    Promise<undefined> waitForReadable()
    get ReadableStreamState readableState

    // Composing with writable streams
    // NB: the return value is actually whatever `dest` is. Hard to express in IDL.
    WritableStream pipe(WritableStream dest, { ToBoolean close = true } = {})

    // Stop accumulating data
    void abort(any reason)

    // Useful helper
    get Promise<undefined> finished

    // Internal properties
    Array [[buffer]] = []
    boolean [[started]] = false
    boolean [[draining]] = false
    boolean [[pulling]] = false
    string [[readableState]] = "waiting"
    any [[storedError]]
    Promise<undefined> [[readablePromise]]
    Promise<undefined> [[finishedPromise]]
    Promise [[startedPromise]]
    function [[onAbort]]
    function [[onPull]]

    // Internal methods
    [[push]](any data)
    [[finish]]()
    [[error]](any e)
    [[callPull]]()
}

enum ReadableStreamState {
    "readable"  // the buffer has something in it; read at will
    "waiting"   // the source is not ready or the buffer is empty; you should call waitForReadable
    "finished"  // all data has been read from both the source and the buffer
    "errored"   // the source errored so the stream is now dead
}
```

##### Properties of the BaseReadableStream prototype

###### constructor({ start, pull, abort })

The constructor is passed several functions, all optional:

- `start(push, finish, error)` is typically used to adapting a push-based data source, as it is called immediately so it can set up any relevant event listeners, or to acquire access to a pull-based data source.
- `pull(push, finish, error)` is typically used to adapt a pull-based data source, as it is called in reaction to `read` calls, or to start the flow of data in push-based data sources. Once it is called, it will not be called again until its passed `push` function is called.
- `abort(reason)` is called when the readable stream is aborted, and should perform whatever source-specific steps are necessary to clean up and stop reading. It is given the abort reason that was given to the stream when calling the public `abort` method, if any.

Both `start` and `pull` are given the ability to manipulate the stream's internal buffer and state by being passed the `this.[[push]]`, `this.[[finish]]`, and `this.[[error]]` functions.

1. Set `this.[[onAbort]]` to `abort`.
1. Set `this.[[onPull]]` to `pull`.
1. Let `this.[[readablePromise]]` be a newly-created pending promise.
1. Let `this.[[finishedPromise]]` be a newly-created pending promise.
1. Call `start(this.[[push]], this.[[finish]], this.[[error]])` and let `this.[[startedPromise]]` be the result of casting the return value to a promise.
1. When/if `this.[[startedPromise]]` is fulfilled, set `this.[[started]]` to `true`.
1. When/if `this.[[startedPromise]]` is rejected with reason `r`, call `this.[[error]](r)`.

###### get readableState

1. Return `this.[[readableState]]`.

###### read()

1. If `this.[[readableState]]` is `"waiting"`,
    1. Throw an error indicating that the stream does not have any data available yet.
1. If `this.[[readableState]]` is `"readable"`,
    1. Assert: `this.[[buffer]]` is not empty.
    1. Let `data` be the result of shifting an element off of the front of `this.[[buffer]]`.
    1. If `this.[[buffer]]` is now empty,
        1. If `this.[[draining]]` is `true`,
            1. Resolve `this.[[finishedPromise]]` with `undefined`.
            1. Let `this.[[readablePromise]]` be a newly-created promise rejected with an error saying that the stream has already been completely read.
            1. Set `this.[[readableState]]` to `"finished"`.
        1. If `this.[[draining]]` is `false`,
            1. Set `this.[[readableState]]` to `"waiting"`.
            1. Let `this.[[readablePromise]]` be a newly-created pending promise.
            1. `this.[[callPull]]()`.
    1. Return `data`.
1. If `this.[[readableState]]` is `"errored"`,
    1. Throw `this.[[storedError]]`.
1. If `this.[[readableState]]` is `"finished"`,
    1. Throw an error indicating that the stream has already been completely read.

###### waitForReadable()

1. If `this.[[readableState]]` is `"waiting"`,
    1. Call `this.[[callPull]]()`.
1. Return `this.[[readablePromise]]`.

###### abort(reason)

1. If `this.[[readableState]]` is `"waiting"`,
    1. Call `this.[[onAbort]](reason)`.
    1. Resolve `this.[[finishedPromise]]` with `undefined`.
    1. Reject `this.[[readablePromise]]` with `reason`.
    1. Set `this.[[readableState]]` to `"finished"`.
1. If `this.[[readableState]]` is `"readable"`,
    1. Call `this.[[onAbort]](reason)`.
    1. Resolve `this.[[finishedPromise]]` with `undefined`.
    1. Let `this.[[readablePromise]]` be a newly-created promise rejected with `reason`.
    1. Clear `this.[[buffer]]`.
    1. Set `this.[[readableState]]` to `"finished"`.

###### get finished

1. Return `this.[[finishedPromise]]`.

###### pipe(dest, { close })

```js
BaseReadableStream.prototype.pipe = (dest, { close = true } = {}) => {
    const source = this;
    close = Boolean(close);

    fillDest();
    return dest;

    function fillDest() {
        if (dest.writableState === "writable") {
            pumpSource();
        } else if (dest.writableState === "waiting") {
            dest.waitForWritable().then(fillDest, abortSource);
        } else {
            // Source has either been closed by someone else, or has errored in the course of
            // someone else writing. Either way, we're not going to be able to do anything
            // else useful.
            abortSource();
        }
    }

    function pumpSource() {
        if (source.readableState === "readable") {
            dest.write(source.read()).catch(abortSource);
            fillDest();
        } else if (source.readableState === "waiting") {
            source.waitForReadable().then(fillDest, disposeDest);
        } else if (source.readableState === "finished") {
            closeDest();
        } else {
            disposeDest();
        }
    }

    function abortSource(reason) {
        source.abort(reason);
    }

    function closeDest() {
        if (close) {
            dest.close();
        }
    }

    function disposeDest(reason) {
        // ISSUE: should this be preventable via an option or via `options.close`?
        dest.dispose(reason);
    }
};
```

##### Internal Methods of BaseReadableStream

###### `[[push]](data)`

1. If `this.[[readableState]]` is `"waiting"`,
    1. Push `data` onto `this.[[buffer]]`.
    1. Set `this.[[pulling]]` to `false`.
    1. Resolve `this.[[readablePromise]]` with `undefined`.
    1. Set `this.[[readableState]]` to `"readable"`.
1. If `this.[[readableState]]` is `"readable"`,
    1. Push `data` onto `this.[[buffer]]`.
    1. Set `this.[[pulling]]` to `false`.

###### `[[finish]]()`

1. If `this.[[readableState]]` is `"waiting"`,
    1. Reject `this.[[readablePromise]]` with an error saying that the stream has already been completely read.
    1. Resolve `this.[[finishedPromise]]` with `undefined`.
    1. Set `this.[[readableState]]` to `"finished"`.
1. If `this.[[readableState]]` is `"readable"`,
    1. Set `this.[[draining]]` to `true`.

###### `[[error]](e)`

1. If `this.[[readableState]]` is `"waiting"`,
    1. Set `this.[[storedError]]` to `e`.
    1. Reject `this.[[finishedPromise]]` with `e`.
    1. Reject `this.[[readablePromise]]` with `e`.
    1. Set `this.[[readableState]]` to `"errored"`.
1. If `this.[[readableState]]` is `"readable"`,
    1. Clear `this.[[buffer]]`.
    1. Set `this.[[storedError]]` to `e`.
    1. Let `this.[[readablePromise]]` be a newly-created promise object rejected with `e`.
    1. Reject `this.[[finishedPromise]]` with `e`.
    1. Set `this.[[readableState]]` to `"errored"`.

###### `[[callPull]]()`

1. If `this.[[pulling]]` is `true`, return.
1. If `this.[[started]]` is `false`,
    1. When/if `this.[[startedPromise]]` is fulfilled, call `this.[[onPull]](this.[[push]], this.[[finish]], this.[[error]])`.
1. If `this.[[started]]` is `true`,
    1. Call `this.[[onPull]](this.[[push]], this.[[finish]], this.[[error]])`.

#### ReadableStream

```
class ReadableStream extends BaseReadableStream {
    // Adds a backpressure strategy argument.
    constructor({
        function start = () => {},
        function pull = () => {},
        function abort = () => {},
        strategy: { function count, function needsMoreData }
    })

    // Overriden to do bookkeeping for the backpressure strategy
    any read()

    // Supports multi-pipe by default, overriding base behavior.
    WritableStream pipe(WritableStream dest, { ToBoolean close = true } = {})

    // Overriden to take into account the backpressure strategy.
    // You can also think of this as part of the constructor override, i.e. it passes
    //   in a different function to `start` and `pull`.
    [[push]](data)

    // Internal properties
    [[tee]]
    [[strategy]]
    [[bufferSize]] = 0
}
```

##### Properties of the ReadableStream Prototype

###### constructor({ start, pull, abort, strategy })

1. Set `this.[[strategy]]` to `strategy`.
1. Call `super({ start, pull, abort })`.

###### read()

1. Let `data` be `super()`.
1. Subtract `this.[[strategy]].count(data)` from `this.[[bufferSize]]`.
1. Return `data`.

###### pipe(dest, { close })

1. Let `alreadyPiping` be `true`.
1. If `this.[[tee]]` is `undefined`, let `this.[[tee]]` be a new `TeeStream` and set `alreadyPiping` to `false`.
1. Call `this.[[tee]].addOut(dest, { close })`.
1. If `alreadyPiping` is `false`, call `super(this.[[tee]], { close: true })`.
1. Return `dest`.

##### Internal Methods of ReadableStream

###### `[[push]](data)`

1. Call `BaseReadableStream`'s version of `this.[[push]](data)`.
1. If `this.[[readableState]]` is now `"readable"`,
    1. Add `this.[[strategy]].count(data)` to `this.[[bufferSize]]`.
    1. Return `this.[[strategy]].needsMoreData(this.[[bufferSize]])`.

## Writable Stream APIs

### BaseWritableStream

```
class BaseWritableStream {
    constructor({
        function start = () => {},
        function write = () => {},
        function close = () => {},
        function dispose = close
    })

    // Writing data to the underlying sink
    Promise<undefined> write(any data)
    Promise<undefined> waitForWritable()
    get WritableStreamState writableState

    // Close off the underlying sink gracefully; we are done.
    Promise<undefined> close()

    // Close off the underlying sink forcefully; everything written so far is suspect.
    Promise<undefined> dispose(any reason)

    // Useful helpers
    get Promise<undefined> closed

    // Internal methods
    [[error]](any e)
    [[doClose]]()
    [[doDispose]](r)
    [[doNextWrite]]({ type, promise, data })

    // Internal properties
    Array [[buffer]] = []
    string [[writableState]] = "waiting"
    any [[storedError]]
    Promise<undefined> [[currentWritePromise]]
    Promise<undefined> [[writablePromise]]
    Promise<undefined> [[closedPromise]]
    function [[onWrite]]
    function [[onClose]]
    function [[onDispose]]
}

enum WritableStreamState {
    "writable" // the sink is ready and the buffer is not yet full; write at will
    "waiting"  // the sink is not ready or the buffer is full; you should call waitForWritable
    "closing"  // the sink is being closed; no more writing
    "closed"   // the sink has been closed
    "errored"  // the sink errored so the stream is now dead
}
```

#### Properties of the BaseWritableStream prototype

##### constructor({ start, write, close, dispose })

The constructor is passed several functions, all optional:

* `start()` is called when the writable stream is created, and should open the underlying writable sink. If this process is asynchronous, it can return a promise to signal success or failure.
* `write(data, done, error)` should write `data` to the underlying sink. It can call its `done` or `error` parameters, either synchronously or asynchronously, to respectively signal that the underlying resource is ready for more data or that an error occurred writing. The stream implementation guarantees that this function will be called only after previous writes have succeeded (i.e. called their `done` parameter), and never after `close` or `dispose` is called.
* `close()` should close the underlying sink. If this process is asynchronous, it can return a promise to signal success or failure. The stream implementation guarantees that this function will be called only after all queued-up writes have succeeded.
* `dispose(reason)` is an abrupt close, signaling that all data written so far is suspect. It should clean up underlying resources, much like `close`, but perhaps with some custom handling. It is sometimes given a reason for this abrupt close as a parameter. Unlike `close`, `dispose` will be called even if writes are queued up, throwing away that data.

In reaction to calls to the stream's `.write()` method, the `write` constructor option is given data from the internal buffer, along with the means to signal that the data has been successfully or unsuccessfully written.

1. Set `this.[[onWrite]]` to `write`.
1. Set `this.[[onClose]]` to `close`.
1. Set `this.[[onDispose]]` to `dispose`.
1. Let `this.[[writablePromise]]` be a newly-created pending promise.
1. Call `start()` and let `startedPromise` be the result of casting the return value to a promise.
1. When/if `startedPromise` is fulfilled,
    1. If `this.[[buffer]]` is empty,
        1. Set `this.[[writableState]]` to `"writable"`.
        1. Resolve `this.[[writablePromise]]` with `undefined`.
    1. Otherwise,
        1. Shift `entry` off of `this.[[buffer]]`.
        1. Call `this.[[doNextWrite]](entry)`.
1. When/if `startedPromise` is rejected with reason `r`, call `this.[[error]](r)`.

##### get closed

1. Return `this.[[closedPromise]]`.

##### get writableState

1. Return `this.[[writableState]]`.

##### write(data)

1. Let `promise` be a newly-created pending promise.
1. If `this.[[writableState]]` is `"writable"`,
    1. Set `this.[[writableState]]` to `"waiting"`.
    1. Set `this.[[writablePromise]]` to be a newly-created pending promise.
    1. Call `this.[[doNextWrite]]({ type: "data", promise, data })`.
    1. Return `promise`.
1. If `this.[[writableState]]` is `"waiting"`,
    1. Push `{ type: "data", promise, data }` onto `this.[[buffer]]`.
    1. Return `promise`.
1. If `this.[[writableState]]` is `"closing"`,
    1. Return a promise rejected with an error indicating that you cannot write while the stream is closing.
1. If `this.[[writableState]]` is `"closed"`,
    1. Return a promise rejected with an error indicating that you cannot write after the stream has been closed.
1. If `this.[[writableState]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

##### close()

1. If `this.[[writableState]]` is `"writable"`,
    1. Set `this.[[writableState]]` to `"closing"`.
    1. Return `this.[[doClose]]()`.
1. If `this.[[writableState]]` is `"waiting"`,
    1. Set `this.[[writableState]]` to `"closing"`.
    1. Let `promise` be a newly-created pending promise.
    1. Push `{ type: "close", promise, data: undefined }` onto `this.[[buffer]]`.
1. If `this.[[writableState]]` is `"closing"`,
    1. Return a promise rejected with an error indicating that you cannot close a stream that is already closing.
1. If `this.[[writableState]]` is `"closed"`,
    1. Return a promise rejected with an error indicating that you cannot close a stream that is already closed.
1. If `this.[[writableState]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

##### dispose(r)

1. If `this.[[writableState]]` is `"writable"`,
    1. Set `this.[[writableState]]` to `"closing"`.
    1. Return `this.[[doDispose]](r)`.
1. If `this.[[writableState]]` is `"waiting"`, or if `this.[[writableState]]` is `"closing"` and `this.[[buffer]]` is not empty,
    1. Set `this.[[writableState]]` to `"closing"`.
    1. For each entry `{ type, promise, data }` in `this.[[buffer]]`, reject `promise` with `r`.
    1. Clear `this.[[buffer]]`.
    1. Return `this.[[doDispose]](r)`.
1. Return a promise resolved with `undefined`.

##### waitForWritable()

1. Return `this.[[writablePromise]]`.

#### Internal Methods of BaseWritableStream

##### `[[error]](e)`

1. If `this.[[writableState]]` is not `"closed"` or `"errored"`,
    1. Reject `this.[[writablePromise]]` with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.
    1. For each entry `{ type, promise, data }` in `this.[[buffer]]`, reject `promise` with `r`.
    1. Set `this.[[storedError]]` to `e`.
    1. Set `this.[[writableState]]` to `"errored"`.

##### `[[doClose]]()`

1. Reject `this.[[writablePromise]]` with an error saying that the stream has been closed.
1. Call `this.[[onClose]]()`.
1. If the call throws an exception `e`, call `this.[[error]](e)` and return a promise rejected with `e`.
1. Otherwise, let `closeResult` be the result of casting the return value to a promise.
1. When/if `closeResult` is fulfilled,
    1. Set `this.[[writableState]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
1. When/if `closeResult` is rejected with reason `r`, call `this.[[error]](r)`.
1. Return `this.[[closedPromise]]`.

##### `[[doDispose]](r)`

1. Reject `this.[[writablePromise]]` with `r`.
1. Call `this.[[onDispose]](r)`.
1. If the call throws an exception `e`, call `this.[[error]](e)` and return a promise rejected with `e`.
1. Otherwise, let `disposeResult` be the result of casting the return value to a promise.
1. When/if `disposeResult` is fulfilled,
    1. Set `this.[[writableState]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
1. When/if `disposeResult` is rejected with reason `r`, call `this.[[error]](r)`.
1. Return `this.[[closedPromise]]`.

##### `[[doNextWrite]]({ type, promise, data })`

1. If `type` is `"close"`,
    1. Assert: `this.[[writableState]]` is `"closing"`.
    1. Call `this.[[doClose]]()`.
    1. Return.
1. Assert: `type` must be `"data"`.
1. Set `this.[[currentWritePromise]]` to `promise`.
1. Let `signalDone` be a new function of zero arguments, closing over `this` and `promise`, that performs the following steps:
    1. If `this.[[currentWritePromise]]` is not `promise`, return.
    1. Set `this.[[currentWritePromise]]` to `undefined`.
    1. If `this.[[writableState]]` is `"waiting"`,
        1. Resolve `promise` with `undefined`.
        1. If `this.[[buffer]]` is not empty,
            1. Shift `entry` off of `this.[[buffer]]`.
            1. Call `this.[[doNextWrite]](entry)`.
        1. If `this.[[buffer]]` is empty,
            1. Set `this.[[writableState]]` to `"writable"`.
            1. Resolve `this.[[writablePromise]]` with `undefined`.
    1. If `this.[[writableState]]` is `"closing"`,
        1. Resolve `promise` with `undefined`.
        1. If `this.[[buffer]]` is not empty,
            1. Shift `entry` off of `this.[[buffer]]`.
            1. Call `this.[[doNextWrite]](entry)`.
1. Call `this.[[onWrite]](data, signalDone, [[error]])`.
1. If the call throws an exception `e`, call `this.[[error]](e)`.

Note: if the constructor's `write` option calls `done` more than once, or after calling `error`, or after the stream has been disposed, then `signalDone` ends up doing nothing.

### WritableStream

```js
class WritableStream extends BaseWritableStream {
    // Adds a backpressure strategy argument.
    constructor({
        function start = () => {},
        function write = () => {},
        function close = () => {},
        function dispose = close,
        strategy: { function count, function needsMoreData }
    })

    // Overriden to take into account backpressure strategy
    Promise<undefined> write(data)

    // Overriden to take into account backpressure strategy.
    // You can also think of this as part of the the constructor and write override.
    [[doNextWrite]]({ type, promise, data })

    // Internal properties
    [[strategy]]
}
```

#### Properties of the WritableStream Prototype

##### constructor({ start, write, close, dispose, strategy })

1. Set `this.[[strategy]]` to `strategy`.
1. Call `super({ start, write, close, dispose })`.

##### write(data)

1. If `this.[[writableState]]` is `"writable"` or `"waiting"`,
    1. Add `this.[[strategy]].count(data)` to `this.[[bufferSize]]`.
1. If `this.[[writableState]]` is `"writable"`,
    1. Let `promise` be a newly-created pending promise.
    1. If `ToBoolean(this.[[strategy]].needsMoreData(this.[[bufferSize]]))` is `false`,
        1. Set `this.[[writableState]]` to `"waiting"`.
        1. Set `this.[[writablePromise]]` to be a newly-created pending promise.
    1. If `this.[[buffer]]` is empty,
        1. Call `this.[[doNextWrite]]({ type: "data", promise, data })`.
    1. Otherwise,
        1. Push `{ type: "data", promise, data }` onto `this.[[buffer]]`.
    1. Return `promise`.
1. Return `super(data)`.

#### Internal Methods of WritableStream

##### `[[doNextWrite]]({ type, promise, data })`

1. Subtract `this.[[strategy]].count(data)` from `this.[[bufferSize]]`.
1. Return the result of calling `BaseWritableStream`'s version of `this.[[doNextWrite]]({ type, promise, data })`.

### CorkableWritableStream

```js
class CorkableWritableStream extends WritableStream {
    // Adds a writev argument.
    constructor({
        function start = () => {},
        function write = () => {},
        function writev = () => {},
        function close = () => {},
        function dispose = close,
        strategy: { function count, function needsMoreData }
    })

    // New methods
    void cork()
    void uncork()

    // Overriden to take into account corking
    Promise<undefined> write(data)
    Promise<undefined> close()

    // TODO: internal properties and overrides to support corking
}
```

TODO!

## Helper APIs

### TeeStream

A "tee stream" is a writable stream which, when written to, itself writes to multiple destinations. It aggregates backpressure and abort signals from those destinations, propagating the appropriate aggregate signals backward.

```js
class TeeStream extends BaseWritableStream {
    constructor() {
        this.[[outputs]] = [];

        super({
            write(data) {
                return Promise.all(this.[[outputs]].map(o => o.dest.write(data)));
            },
            close() {
                const outputsToClose = this.[[outputs]].filter(o => o.close);
                return Promise.all(outputsToClose.map(o => o.dest.write(data)));
            },
            dispose(reason) {
                return Promise.all(this.[[outputs]].map(o => o.dest.dispose(reason)));
            }
        });
    }

    addOut(dest, { close = true } = {}) {
        this.[[outputs]].push({ dest, close });
    }
}
```

### LengthBufferingStrategy

A common buffering strategy when dealing with binary or string data is to wait until the accumulated `length` properties of the incoming data reaches a specified `highWaterMark`. As such, this is provided as a built-in helper along with the stream APIs.

```js
class LengthBufferingStrategy {
    constructor({ highWaterMark }) {
        this.highWaterMark = Number(highWaterMark);

        if (Number.isNaN(this.highWaterMark) || this.highWaterMark < 0) {
            throw new RangeError("highWaterMark must be a nonnegative number.");
        }
    }

    count(chunk) {
        return chunk.length;
    }

    needsMoreData(bufferSize) {
        return bufferSize < this.highWaterMark;
    }
}
```

Note that both of the examples of [creating readable streams](#example-creation) could have used this, replacing their `strategy:` option with `strategy: new LengthBufferingStrategy({ highWaterMark })`.

### CountBufferingStrategy

A common buffering strategy when dealing with object streams is to simply count the number of objects that have been accumulated so far, waiting until this number reaches a specified `highWaterMark`. As such, this strategy is also provided as a built-in helper.

```js
class CountBufferingStrategy {
    constructor({ highWaterMark }) {
        this.highWaterMark = Number(highWaterMark);

        if (Number.isNaN(this.highWaterMark) || this.highWaterMark < 0) {
            throw new RangeError("highWaterMark must be a nonnegative number.");
        }
    }

    count(chunk) {
        return 1;
    }

    needsMoreData(bufferSize) {
        return bufferSize < this.highWaterMark;
    }
}
```

---

<p xmlns:dct="http://purl.org/dc/terms/" xmlns:vcard="http://www.w3.org/2001/vcard-rdf/3.0#">
    <a rel="license"
       href="http://creativecommons.org/publicdomain/zero/1.0/">
        <img src="http://i.creativecommons.org/p/zero/1.0/88x31.png" style="border-style: none;" alt="CC0" />
    </a>
    <br />
    To the extent possible under law,
    <a rel="dct:publisher" href="http://domenicdenicola.com"><span property="dct:title">Domenic Denicola</span></a>
    has waived all copyright and related or neighboring rights to
    <span property="dct:title">whatwg/streams</span>.

    This work is published from:
    <span property="vcard:Country" datatype="dct:ISO3166" content="US" about="http://domenicdenicola.com">
      United States
    </span>.
</p>
