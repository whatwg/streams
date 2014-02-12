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
    - You must be able to communicate abort signals up a pipe chain.
    - You must be able to communicate abort signals down a pipe chain.
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
    - Supports piping to more than one destination, by using the `TeeStream` transform stream within its `pipeTo` method.

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
   - An `EventTarget` (or similar?) which taps into a given readable stream and emit `"data"`, `"error"`, and `"closed"` events for those which wish to watch its progress.
   - This could be implemented entirely in user-land, but is provided to solve a common use case.
- `WritableStreamWatcher`
   - Same thing as `ReadableStreamWatcher`, but for writable streams.

### A Note on Conventions

The interfaces here are specified in a very loose definition language. This language is meant to invoke ECMAScript semantics and to ensure nobody interprets these APIs as conforming to WebIDL conventions, since formalization of this specification will use ECMAScript semantics instead of WebIDL ones. For example, parameters will not be type-validated, but simply used; if they don't implement the appropriate interface, using them will cause errors to be thrown appropriately. This will allow e.g. piping to ad-hoc user-constructed writable streams consisting of object literals with a few specific methods, or better subclassing, or application of generic methods to user-constructed streams.

In other words, over time the definitions given below will disappear, replaced with interface definitions as in the ECMAScript spec (see [Map](http://people.mozilla.org/%7Ejorendorff/es6-draft.html#sec-properties-of-the-map-prototype-object) and [Promise](https://github.com/domenic/promises-unwrapping#properties-of-the-promise-prototype-object)). So don't worry too much about the dialect it's written in, except insofar as it should help or hinder understanding.

## Readable Streams

The *readable stream* abstraction represents a *source* of data, from which you can read. In other words, data comes *out* of a readable stream. At the lower level of the I/O sources which readable streams abstract, there are generally two types of sources: *push sources* and *pull sources*. The readable stream APIs presented here are designed to allow wrapping of both types of sources behind a single, unified interface.

A push source, e.g. a TCP socket, will push data at you; this is somewhat comparable to the higher-level event emitter abstraction. It may also provide a mechanism for pausing and resuming the flow of data (in the TCP socket example, by changing the TCP window size). The process of communicating this pause signal to the source, when more data is being pushed than the ultimate consumer can handle, is called *backpressure*. Backpressure can propagate through a piped-together chain of streams: that is, if the ultimate consumer chooses not to read from the final readable stream in the chain, then the mechanisms of the stream API will propagate this backward through the chain to the original source readable stream, which then sends the pause signal to the push source.

A pull source, e.g. a file handle, requires you to request data from it. The data may be available synchronously (e.g. held in OS memory buffers), or asynchronously. Pull sources are generally simpler to work with, as backpressure is achieved almost automatically. In a piped-together chain of streams where the original readable stream wraps a pull source, read requests are propagated from the ultimate consumer's read of the final readable stream in the chain, all the way back to the original source readable stream.

A final consideration when dealing with readable streams is the *buffering strategy*, which is closely related to how backpressure is handled. First, we note that for push sources, a stream must maintain an internal buffer of data that has been pushed from the source but not yet read out of the stream. The most naive strategy is, once this buffer becomes nonempty, to attempt to pause the underlying source—and once it is drained, to resume the flow of data. Similarly, we consider pull sources: the most naive strategy does not employ a buffer, but simply pulls from the source whenever the stream is read from. It is exactly these naive buffering strategies that are implemented by the `BaseReadableStream` API, which is a lower-level building block designed to wrap pull and push sources into a uniform API. The higher-level `ReadableStream` API allows the implementation of more complex buffering strategies, based on *high water marks*. For readable streams wrapping push sources, a high water mark denotes the level to which the buffer is allowed to fill before trying to pause the push source: this allows the accumulation of some incoming data in memory without impeding the flow from the source, so that it can be flushed through the system more quickly when the consumer is ready to read from the stream. For readable streams wrapping pull sources, a high water mark denotes how much data should be "proactively" pulled into a buffer, even before that data is read out of the stream; this allows larger pulls from the source.

Together, these considerations form the foundation of our readable streams API. It is designed to allow wrapping of both pull and push sources into a single `ReadableStream` abstraction. To accomplish this, the API uses the *revealing constructor pattern*, pioneered by the promises specification (TODO: link to blog post). The constructor of a given stream instance is supplied with two functions, `start` and `pull`, which each are given the parameters `(push, close, error)` representing capabilities tied to the internals of the stream. (Typically, streams wrapping push sources will put most of their logic in `start`, while those wrapping pull sources will put most of their logic in `pull`.) By mediating all access to the internal state machine through these three functions, the stream's internal state and bookkeeping can be kept private, allowing nobody but the original producer of the stream to insert data into it.

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

Let's assume we have some raw C++ socket object or similar, which presents the above API. This is a simplified version of how you could create a `ReadableStream` wrapping this raw socket object. (For a more complete version, see [the examples document](Examples.md).)

```js
function makeStreamingSocket(host, port) {
    const rawSocket = createRawSocketObject(host, port);

    return new ReadableStream({
        start(push, close, error) {
            rawSocket.ondata = chunk => {
                if (!push(chunk)) {
                    rawSocket.readStop();
                }
            };

            rawSocket.onend = close;

            rawSocket.onerror = error;
        },

        pull() {
            rawSocket.readStart();
        }
    });
}

var socket = makeStreamingSocket("http://example.com", 80);
```

Here we see a pattern very typical of readable streams that wrap push sources: they do most of their work in the `start` constructor parameter. There, it sets up listeners to call `push` with any incoming data; to call `close` if the source has no more data; and to call `error` if the source errors. These three functions—`push`, `close`, and `error`—are given to the supplied `start` parameter, allowing `start` to push onto the internal buffer and otherwise manipulate internal state. `start` is called immediately upon creation of the readable stream, so you can be sure that these listeners were attached immediately after the `rawSocket` object was created.

Note how the `ondata` handler checks the return value of the `push` function, and if it's falsy, it tries to stop the flow of data from the raw socket. `push` returns a boolean that is `true` only if the stream's internal buffer has not yet been filled. If the return value is instead `false`, that means the buffer is full: a backpressure signal. Thus we call `rawSocket.readStop()` to propagate this backpressure signal to the underlying socket.

Finally, we come to the `pull` constructor parameter. `pull` is called whenever the stream's internal buffer has been emptied, but the consumer still wants more data. In this case of a push source, the correct action is to ensure that data is flowing from the raw socket, in case it had been previously paused.

#### Adapting a Pull-Based Data Source

In general, a pull-based data source can be modeled as:

- An `open(cb)` method that gains access to the source; it can call `cb` either synchronous or asynchronously, with either `(err)` or `(null)`.
- A `read(cb)` function method that gets data from the source; can call `cb` either synchronously or asynchronously, with either `(err, null, null)` indicating an error, or `(null, true, null)` indicating there is no more data, or `(null, false, data)` indicating there is data.
- A `close(cb)` method that releases access to the source; can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.

Let's assume that we have some raw C++ file handle API matching this type of setup. This is a simplified version of how you could create a `ReadableStream` wrapping this raw file handle object. (Again, see the examples document for more.)

```js
function makeStreamingReadableFile(filename) {
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

        pull(push, close, error) {
            fileHandle.read((err, done, data) => {
                if (err) {
                    error(err);
                } else if (done) {
                    fileHandle.close(err => {
                        if (err) {
                            error(err);
                        }
                        close();
                    });
                } else {
                    push(data);
                }
            });
        }
    });
}

var file = makeStreamingReadableFile("/example/path/on/fs.txt");
```

Here we see that the tables are reversed, and the most interesting work is done in the `pull` constructor parameter. `start` simply returns a new promise which is fulfilled if the file handle opens successfully, or is rejected if there is an error doing so. Whereas `pull` proxies requests for more data to the underlying file handle, using the `push`, `close`, and `error` functions to manipulate the stream's internal buffer and state.

### Examples: Consuming a Readable Stream

In the previous section, we discussed how to create readable streams wrapping arbitrary data sources. The beauty of this approach is that, once you have such a readable stream, you can interface with it using the same simple API, no matter where it came from—and all the low-level concerns like buffering, backpressure, or what type of data source you're dealing with are abstracted away.

#### Using `pipeTo`

The primary means of consuming a readable stream is through its `pipeTo` method, which accepts a writable stream, and manages the complex dance required for writing data to the writable stream only as fast as it can accept. The writable stream's  rate of intake is used to govern how fast data is read from the readable stream, thus taking care of the propagation of backpressure signals. A typical pipe scenario might look like:

```js
readableStream.pipeTo(writableStream).closed
    .then(() => console.log("All written!"))
    .catch(err => console.error("Something went wrong!", err));
```

90% of the time, this is all that will be required: you will rarely, if ever, have to read from a readable stream yourself. Simply piping to a writable stream, and letting the pipe algorithm take care of all the associated complexity, is often enough.

#### Using `read()`/`wait()`/`state`

For those times when you do need to consume a readable stream directly, the usual pattern is to pump it, alternating between using the `read()` and `wait()` methods by consulting its `state` property. For example, this function writes the contents of a readable stream to the console as fast as it can.

```js
function streamToConsole(readableStream) {
    pump();

    function pump() {
        while (readableStream.state === "readable") {
            console.log(readableStream.read());
        }

        if (readableStream.state === "closed") {
            console.log("--- all done!");
        } else {
            // If we're in an error state, the returned promise will be rejected with that error,
            // so no need to handle "waiting" vs. "errored" separately.
            readableStream.wait().then(pump, e => console.error(e));
        }
    }
}
```

This function essentially handles each possible state of the stream separately. If the stream is in the `"waiting"` state, meaning there's no data available yet, we call `readableStream.wait()` to get a promise that will be fulfilled when data becomes available. (This has the side effect of signaling to the stream that we are ready for data, which the stream might use to resume the flow from any underlying data sources.)

Once data is available, the stream transitions to the `"readable"` state. We use a `while` loop to continue to read chunks of data for as long as they are still available; typically this will only be a few iterations. (Sometimes people get confused at this point, thinking that this is a kind of blocking polling loop; it is not. It simply makes sure to empty the internal buffer of all available chunks.) Note that `readableStream.read()` synchronously returns the available data to us from the stream's internal buffer. This is especially important since often the OS is able to supply us with data synchronously; a synchronous `read` method thus gives the best possible performance.

Once all the available data is read from the stream's internal buffer, the stream can go back to `"waiting"`, as more data is retrieved from the underlying source. The stream will alternate between `"waiting"` and `"readable"` until at some point it transitions to either `"closed"` or `"errored"` states. In either of those cases, we log the event to the console, and are done!

### Other APIs on Readable Streams

Besides the constructor pattern, the `pipeTo` method for piping a readable stream into a writable stream, and the `read()`/`wait()`/`state` primitives for reading raw data, a readable stream provides three more APIs: `pipeThrough`, `closed`, and `abort(reason)`.

`pipeThrough` is a mechanism for piping readable streams through *transform streams*, which are represented as `{ input, output }` pairs where `input` is a writable stream and `output` is a readable stream. Transform streams could have predefined translation logic, e.g. a string decoder whose `input` writable stream takes `ArrayBuffer` instances and whose `output` readable stream gives back strings; or they could be dynamic transformations, for example a web worker or child process which reacts to data flowing to its `input` side in order to decide what to give from its `output` side.

`closed` is a simple convenience API: it's a promise that becomes fulfilled when the stream has been completely read (`state` of `"closed"`), or becomes rejected if some error occurs in the stream (`state` of `"errored"`).

The abort API is a bit more subtle. It allows consumers to communicate a *loss of interest* in the stream's data; you could use this, for example, to abort a file download stream if the user clicks "Cancel." The main functionality of abort is handled by another constructor parameter, alongside `start` and `pull`: for example, we might extend our above socket stream with an `abort` parameter like so:

```js
return new ReadableStream({
    start(push, close, error) { /* as before */ },
    pull() { /* as before */ }
    abort() {
        rawSocket.readStop();
        rawSocket = null;
    }
});
```

In addition to calling the `abort` function given in the stream's constructor, a readable stream's `abort(reason)` method cleans up the stream's internal buffer and ensures that the `pull` constructor parameter is never called again. It puts the stream in the `"closed"` state—aborting is not considered an error—but any further attempts to `read()` will result in `reason` being thrown, and attempts to call `wait()` will give a promise rejected with `reason`.

### The Readable Stream State Diagram

As you've probably gathered from the above explanations, readable streams have a fairly complex internal state machine, which is responsible for keeping track of the internal buffer, and initiating appropriate actions in response to calls to a stream's methods. This can be roughly summarized in the following diagram:

![A state machine diagram of a readable stream, showing transitions between waiting (starting = true), waiting (starting = false), readable (draining = false), readable (draining = true), closed, and errored states.](https://rawgithub.com/whatwg/streams/master/readable-stream.svg)

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
    Promise<undefined> wait()
    get ReadableStreamState state

    // Composing with other streams
    WritableStream pipeTo(WritableStream dest, { ToBoolean close = true } = {})
    ReadableStream pipeThrough({ WritableStream in, ReadableStream out }, options)

    // Stop accumulating data
    void abort(any reason)

    // Useful helper
    get Promise<undefined> closed

    // Internal properties
    Array [[buffer]] = []
    boolean [[started]] = false
    boolean [[draining]] = false
    boolean [[pulling]] = false
    string [[state]] = "waiting"
    any [[storedError]]
    Promise<undefined> [[readablePromise]]
    Promise<undefined> [[closedPromise]]
    Promise [[startedPromise]]
    function [[onAbort]]
    function [[onPull]]

    // Internal methods for use by the underlying source
    [[push]](any data)
    [[close]]()
    [[error]](any e)

    // Other internal helper methods
    [[callPull]]()
}

enum ReadableStreamState {
    "readable"  // the buffer has something in it; read at will
    "waiting"   // the source is not ready or the buffer is empty; you should call wait
    "closed"  // all data has been read from both the source and the buffer
    "errored"   // the source errored so the stream is now dead
}
```

##### Properties of the BaseReadableStream prototype

###### constructor({ start, pull, abort })

The constructor is passed several functions, all optional:

- `start(push, close, error)` is typically used to adapting a push-based data source, as it is called immediately so it can set up any relevant event listeners, or to acquire access to a pull-based data source.
- `pull(push, close, error)` is typically used to adapt a pull-based data source, as it is called in reaction to `read` calls, or to start the flow of data in push-based data sources. Once it is called, it will not be called again until its passed `push` function is called.
- `abort(reason)` is called when the readable stream is aborted, and should perform whatever source-specific steps are necessary to clean up and stop reading. It is given the abort reason that was given to the stream when calling the public `abort` method, if any.

Both `start` and `pull` are given the ability to manipulate the stream's internal buffer and state by being passed the `this.[[push]]`, `this.[[close]]`, and `this.[[error]]` functions.

1. If IsCallable(_start_) is **false**, throw a **TypeError** exception.
1. If IsCallable(_pull_) is **false**, throw a **TypeError** exception.
1. If IsCallable(_abort_) is **false**, throw a **TypeError** exception.
1. Set `this.[[onAbort]]` to `abort`.
1. Set `this.[[onPull]]` to `pull`.
1. Let `this.[[readablePromise]]` be a newly-created pending promise.
1. Let `this.[[closedPromise]]` be a newly-created pending promise.
1. Call `start(this.[[push]], this.[[close]], this.[[error]])` and let `this.[[startedPromise]]` be the result of casting the return value to a promise.
1. When/if `this.[[startedPromise]]` is fulfilled, set `this.[[started]]` to `true`.
1. When/if `this.[[startedPromise]]` is rejected with reason `r`, call `this.[[error]](r)`.

###### get state

1. Return `this.[[state]]`.

###### read()

1. If `this.[[state]]` is `"waiting"`,
    1. Throw a `TypeError` exception.
1. If `this.[[state]]` is `"readable"`,
    1. Assert: `this.[[buffer]]` is not empty.
    1. Let `data` be the result of shifting an element off of the front of `this.[[buffer]]`.
    1. If `this.[[buffer]]` is now empty,
        1. If `this.[[draining]]` is `true`,
            1. Resolve `this.[[closedPromise]]` with `undefined`.
            1. Let `this.[[readablePromise]]` be a newly-created promise rejected with a `TypeError` exception.
            1. Set `this.[[state]]` to `"closed"`.
        1. If `this.[[draining]]` is `false`,
            1. Set `this.[[state]]` to `"waiting"`.
            1. Let `this.[[readablePromise]]` be a newly-created pending promise.
            1. `this.[[callPull]]()`.
    1. Return `data`.
1. If `this.[[state]]` is `"errored"`,
    1. Throw `this.[[storedError]]`.
1. If `this.[[state]]` is `"closed"`,
    1. Throw a `TypeError` exception.

###### wait()

1. If `this.[[state]]` is `"waiting"`,
    1. Call `this.[[callPull]]()`.
1. Return `this.[[readablePromise]]`.

###### abort(reason)

1. If `this.[[state]]` is `"waiting"`,
    1. Call `this.[[onAbort]](reason)`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
    1. Reject `this.[[readablePromise]]` with `reason`.
    1. Set `this.[[state]]` to `"closed"`.
1. If `this.[[state]]` is `"readable"`,
    1. Call `this.[[onAbort]](reason)`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
    1. Let `this.[[readablePromise]]` be a newly-created promise rejected with `reason`.
    1. Clear `this.[[buffer]]`.
    1. Set `this.[[state]]` to `"closed"`.

###### get closed

1. Return `this.[[closedPromise]]`.

###### pipeTo(dest, { close })

```js
BaseReadableStream.prototype.pipeTo = (dest, { close = true } = {}) => {
    const source = this;
    close = Boolean(close);

    fillDest();
    return dest;

    function fillDest() {
        if (dest.state === "writable") {
            pumpSource();
        } else if (dest.state === "waiting") {
            dest.wait().then(fillDest, abortSource);
        } else {
            // Source has either been closed by someone else, or has errored in the course of
            // someone else writing. Either way, we're not going to be able to do anything
            // else useful.
            abortSource();
        }
    }

    function pumpSource() {
        if (source.state === "readable") {
            dest.write(source.read()).catch(abortSource);
            fillDest();
        } else if (source.state === "waiting") {
            source.wait().then(fillDest, abortDest);
        } else if (source.state === "closed") {
            closeDest();
        } else {
            abortDest();
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

    function abortDest(reason) {
        // ISSUE: should this be preventable via an option or via `options.close`?
        dest.abort(reason);
    }
};
```

###### pipeThrough({ input, output }, options)

1. If Type(_input_) is not Object, then throw a **TypeError** exception.
1. If Type(_output_) is not Object, then throw a **TypeError** exception.
1. Let _stream_ be the **this** value.
1. Let _result_ be the result of calling Invoke(_stream_, `"pipeTo"`, (_options_)).
1. ReturnIfAbrupt(_result_).
1. Return _output_.

##### Internal Methods of BaseReadableStream

###### `[[push]](data)`

1. If `this.[[state]]` is `"waiting"`,
    1. Push `data` onto `this.[[buffer]]`.
    1. Set `this.[[pulling]]` to `false`.
    1. Resolve `this.[[readablePromise]]` with `undefined`.
    1. Set `this.[[state]]` to `"readable"`.
1. If `this.[[state]]` is `"readable"`,
    1. Push `data` onto `this.[[buffer]]`.
    1. Set `this.[[pulling]]` to `false`.
1. Return `false`.

###### `[[close]]()`

1. If `this.[[state]]` is `"waiting"`,
    1. Reject `this.[[readablePromise]]` with a `TypeError` exception.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
    1. Set `this.[[state]]` to `"closed"`.
1. If `this.[[state]]` is `"readable"`,
    1. Set `this.[[draining]]` to `true`.

###### `[[error]](e)`

1. If `this.[[state]]` is `"waiting"`,
    1. Set `this.[[storedError]]` to `e`.
    1. Reject `this.[[closedPromise]]` with `e`.
    1. Reject `this.[[readablePromise]]` with `e`.
    1. Set `this.[[state]]` to `"errored"`.
1. If `this.[[state]]` is `"readable"`,
    1. Clear `this.[[buffer]]`.
    1. Set `this.[[storedError]]` to `e`.
    1. Let `this.[[readablePromise]]` be a newly-created promise object rejected with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.
    1. Set `this.[[state]]` to `"errored"`.

###### `[[callPull]]()`

1. If `this.[[pulling]]` is `true`, return.
1. Set `this.[[pulling]]` to `true`.
1. If `this.[[started]]` is `false`,
    1. When/if `this.[[startedPromise]]` is fulfilled, call `this.[[onPull]](this.[[push]], this.[[close]], this.[[error]])`.
1. If `this.[[started]]` is `true`,
    1. Call `this.[[onPull]](this.[[push]], this.[[close]], this.[[error]])`.

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
    WritableStream pipeTo(WritableStream dest, { ToBoolean close = true } = {})

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

###### pipeTo(dest, { close })

1. Let `alreadyPiping` be `true`.
1. If `this.[[tee]]` is `undefined`, let `this.[[tee]]` be a new `TeeStream` and set `alreadyPiping` to `false`.
1. Call `this.[[tee]].addOut(dest, { close })`.
1. If `alreadyPiping` is `false`, call `super(this.[[tee]], { close: true })`.
1. Return `dest`.

##### Internal Methods of ReadableStream

###### `[[push]](data)`

1. Call `BaseReadableStream`'s version of `this.[[push]](data)`.
1. If `this.[[state]]` is now `"readable"`,
    1. Add `this.[[strategy]].count(data)` to `this.[[bufferSize]]`.
    1. Return `this.[[strategy]].needsMoreData(this.[[bufferSize]])`.
1. Return `false`.

## Writable Streams

The *writable stream* abstraction represents a *sink* for data, to which you can write. In other words, data comes *in* to a writable stream. After a writable stream is created, two fundamental operations can be performed on it: data can be written to it, and the stream can be closed, allowing any underlying resources to be released.

The complexity of the writable stream API comes from the fact that, in general, the underlying data sink for a writable stream will not be equipped to deal with concurrent writes; the expectation is that a write must complete, successfully, before more data can be written. Such a constraint is too restrictive for a higher-level streaming API: new incoming data will often be ready before the previous data has been successfully written. A vivid example of this would be piping from a fast readable file stream to a slower writable network socket stream. Thus, the writable stream API abstracts away this complication by using an internal buffer of queued writes, which it forwards to the underlying sink one write at a time.

The `WritableStream` constructor accepts a variety of options that dictate how the stream will react to various situations. The implementation takes care to coordinate these operations, so that e.g. `write` is never called before the promise returned by `start` fulfills, and `close` is only called after all `write`s have succeeded.

### Example: Using the `WritableStream` Constructor

To illustrate how the `WritableStream` constructor works, consider the following example. In general, a data sink can be modeled as:

* An `open(cb)` method that gains access to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.
* A `write(data, cb)` method that writes `data` to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`. Importantly, it will fail if you call it indiscriminately; you must wait for the callback to come back—possibly synchronously—with a success before calling it again.
* A `close(cb)` method that releases access to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.

Let's assume we have some raw C++ file handle API matching this type of setup. This is a simplified version of how you could create a `WritableStream` wrapping this raw file handle object.

````js
function makeStreamingWritableFile(filename) {
    const fileHandle = createRawFileHandle(filename);

    return new WritableStream({
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

        write(data, done, error) {
            fileHandle.write(data, err => {
                if (err) {
                    fileHandle.close(closeErr => {
                        if (closeErr) {
                            error(closeErr);
                        }
                        error(err);
                    });
                }
                done();
            });
        },

        close() {
            return new Promise((resolve, reject) => {
                fileHandle.close(err => {
                    if (err) {
                        reject(err);
                    }
                    resolve();
                });
            });
        }
    });
}

var file = makeStreamingWritableFile("/example/path/on/fs.txt");
```

As you can see, this is fairly straightforward: we simply supply constructor parameters that adapt the raw file handle API into an expected form. The writable stream's internal mechanisms will take care of the rest, ensuring that these supplied operations are queued and sequenced correctly when a consumer writes to the resulting writable stream.

Here we start to see our first glimpse of how backpressure signals are given off by a writable stream. The above code makes it clear that, if a particular call to `fileHandle.write` takes a longer time, `done` will be called later. In the meantime, users of the writable stream may have queued up additional writes, which are stored in the stream's internal buffer. The accumulation of this buffer can move the stream into a "waiting" state, which is a signal to users of the stream that they should back off and stop writing if possible.

### Examples: Using a Writable Stream

Once you have a writable stream wrapping whatever low-level sink you hope to write to, you can now use the writable stream API to easily and efficiently write to it. All of the low-level concerns about proper order of operations are greatly simplified by the stream's internal state machine, leaving you with an easier-to-use higher-level API.

#### Using `pipeTo`

The primary means of using a writable stream is by piping a readable stream into it. This will automatically take care of backpressure for you, as it only reads from the readable stream as fast as the writable stream is able to handle it—which, as we showed above, depends on how fast the underlying sink is able to accept data.

Again, we emphasize that piping is the 90% case: you will rarely, if ever, have to write to a writable stream yourself. You will instead pipe to it from a readable stream, just as before:

```js
readableStream.pipeTo(writableStream).closed
    .then(() => console.log("All written!"))
    .catch(err => console.error("Something went wrong!", err));
```

#### Using `write()`/`wait()`/`state`/`close()`

If you do need to write to a writable stream directly, you'll want to employ a similar pattern to dealing with a readable stream: alternating between calls to `write()` while the stream has a `state` of `"writable"`, with calls to `wait()` once it reaches a `state` of `"waiting"`. For example, this function writes an array of data chunks into a writable stream, pausing to log a message if the writable stream needs a break.

```js
function writeArrayToStreamWithBreaks(array, writableStream) {
    pump();

    var index = 0;

    function pump() {
        while (index < array.length && writableStream.state === "writable") {
            writableStream.write(array[index++]).catch(e => console.error(e));
        }

        if (index === array.length) {
            writableStream.close().then(() => console.log("All done!"))
                                  .catch(e => console.error("Error with the stream", e));
        } else if (writableStream.state === "waiting") {
            console.log("Waiting until all queued writes have been flushed through.");
            writableStream.wait().then(pump, e => console.error(e));
        }
    }
}
```

If the writable stream is in a writable state, and we have more data to write, then we do so until one of those conditions becomes false, using a `while` loop to continually call `writableStream.write(data)` as long as that is true. Eventually, either we will run out of data, or the stream will no longer be writable. If we ran out of data, then we close the stream, being sure to wait for successful completion of the close operation before announcing our success. If we haven't run out of data, then the stream must have transitioned to a waiting state, meaning that its internal buffer is getting full, and we should pause if possible. We log a message to that effect, then call `writableStream.wait()` to get a promise that will be fuflilled when all the previously-queued writes have been flushed to the underlying sink. When this happens, the stream will be back in a writable state, and we continue that process.

#### Ignoring `state`

The previous example was somewhat silly, as we didn't effectively use the information that the writable stream's internal buffer was full. Typically, you would use that information to communicate a backpressure signal to a data source, possibly through the readable stream API's mechanisms for automatically doing this if you don't call `read()`. (Indeed, this very process can be seen, in its most generic form, in the `pipeTo` method of `BaseReadableStream`.) If the data is already in memory anyway, there's nothing to be gained by delaying calls to `write()` until the stream signals it is writable; there's nowhere to signal backpressure to.

With that in mind, here is a much simpler version of our above function, which has the same effect, except it doesn't notify us about the stream's queued writes buffer.

```js
function writeArrayToStream(array, writableStream) {
    array.forEach(function (chunk) {
        writableStream.write(chunk);
    });

    writableStream.close().then(() => console.log("All done!"))
                          .catch(e => console.error("Error with the stream", e));
}
```

This function simply queues all the writes immediately, counting on the stream implementation to deliver them as appropriate, and then listens for success or failure by attaching to the return value of the `close()` promise. The lesson of this example is that the `state` property is merely informational, and can be used usefully, but it is not necessary to consult it before writing to the stream.

Note how we don't even add handlers for the promises returned by `writableStream.write(chunk)`. Instead, we just add handlers to the promise returned from `writableStream.close()`. This works out, because if any errors were to occur while writing to the stream, they would cause `close()` to return a promise rejected with that error.

### Other APIs on Writable Streams

Besides the constructor pattern, the `write(data)`/`wait()`/`state` primitives for writing, and the `close()` primitive for closing the underlying sink, a writable stream provides two more APIs: `closed` and `abort(reason)`.

`closed` is simply a convenience API: it's a promise that becomes fulfilled when the stream has been successfully closed (`state` of `"closed"`), or becomes rejected if some error occurs while starting, writing to, or closing the stream (`state` of `"errored"`).

The `abort` API allows users to communicate a *forceful closes* of the stream; this could be useful, for example, to stop a file upload if the user clicks "Cancel." Aborting a stream will clear any queued writes (and close operations), and then call the `abort` constructor parameter immediately. By default the `abort` constructor parameter will simply do whatever the user passed in for the `close` constructor parameter, but by passing a customized function, the creator of the stream can react to forceful closes differently than normal ones. For example, we might extend our above file stream with a `abort` parameter that deletes the file if it was newly created by this write operation:

```
return new WritableStream({
    start() { /* as before */ },
    write(data, done, error) { /* as before */ },
    close() { /* as before */ },
    abort() {
        if (fileHandle.isNew) {
            deleteFileHandle(fileHandle, err => {
                if (err) {
                    reject(err);
                }
                resolve();
            });
        }
    }
});
```

Calling `abort(reason)` puts the writable stream into a `"closed"` state—aborting is not considered an error—but any further attempts to call `write()`, `wait()`, or `close()` will immediately return a promise rejected with `reason`.

### The Writable Stream State Diagram

As with readable streams, we can summarize the internal state machine of writable streams in the following diagram:

TODO

### Writable Stream APIs

#### BaseWritableStream

```
class BaseWritableStream {
    constructor({
        function start = () => {},
        function write = () => {},
        function close = () => {},
        function abort = close
    })

    // Writing data to the underlying sink
    Promise<undefined> write(any data)
    Promise<undefined> wait()
    get WritableStreamState state

    // Close off the underlying sink gracefully; we are done.
    Promise<undefined> close()

    // Close off the underlying sink forcefully; everything written so far is suspect.
    Promise<undefined> abort(any reason)

    // Useful helpers
    get Promise<undefined> closed

    // Internal methods
    [[error]](any e)
    [[doClose]]()
    [[doAbort]](r)
    [[doNextWrite]]({ type, promise, data })

    // Internal properties
    Array [[buffer]] = []
    string [[state]] = "waiting"
    any [[storedError]]
    Promise<undefined> [[currentWritePromise]]
    Promise<undefined> [[writablePromise]]
    Promise<undefined> [[closedPromise]]
    function [[onWrite]]
    function [[onClose]]
    function [[onAbort]]
}

enum WritableStreamState {
    "writable" // the sink is ready and the buffer is not yet full; write at will
    "waiting"  // the sink is not ready or the buffer is full; you should call wait
    "closing"  // the sink is being closed; no more writing
    "closed"   // the sink has been closed
    "errored"  // the sink errored so the stream is now dead
}
```

##### Properties of the BaseWritableStream prototype

###### constructor({ start, write, close, abort })

The constructor is passed several functions, all optional:

* `start()` is called when the writable stream is created, and should open the underlying writable sink. If this process is asynchronous, it can return a promise to signal success or failure.
* `write(data, done, error)` should write `data` to the underlying sink. It can call its `done` or `error` parameters, either synchronously or asynchronously, to respectively signal that the underlying resource is ready for more data or that an error occurred writing. The stream implementation guarantees that this function will be called only after previous writes have succeeded (i.e. called their `done` parameter), and never after `close` or `abort` is called.
* `close()` should close the underlying sink. If this process is asynchronous, it can return a promise to signal success or failure. The stream implementation guarantees that this function will be called only after all queued-up writes have succeeded.
* `abort(reason)` is an abrupt close, signaling that all data written so far is suspect. It should clean up underlying resources, much like `close`, but perhaps with some custom handling. It is sometimes given a reason for this abrupt close as a parameter. Unlike `close`, `abort` will be called even if writes are queued up, throwing away that data.

In reaction to calls to the stream's `.write()` method, the `write` constructor option is given data from the internal buffer, along with the means to signal that the data has been successfully or unsuccessfully written.

1. If IsCallable(_start_) is **false**, throw a **TypeError** exception.
1. If IsCallable(_write_) is **false**, throw a **TypeError** exception.
1. If IsCallable(_close_) is **false**, throw a **TypeError** exception.
1. If IsCallable(_abort_) is **false**, throw a **TypeError** exception.
1. Set `this.[[onWrite]]` to `write`.
1. Set `this.[[onClose]]` to `close`.
1. Set `this.[[onAbort]]` to `abort`.
1. Let `this.[[writablePromise]]` be a newly-created pending promise.
1. Call `start()` and let `startedPromise` be the result of casting the return value to a promise.
1. When/if `startedPromise` is fulfilled,
    1. If `this.[[buffer]]` is empty,
        1. Set `this.[[state]]` to `"writable"`.
        1. Resolve `this.[[writablePromise]]` with `undefined`.
    1. Otherwise,
        1. Shift `entry` off of `this.[[buffer]]`.
        1. Call `this.[[doNextWrite]](entry)`.
1. When/if `startedPromise` is rejected with reason `r`, call `this.[[error]](r)`.

###### get closed

1. Return `this.[[closedPromise]]`.

###### get state

1. Return `this.[[state]]`.

###### write(data)

1. Let `promise` be a newly-created pending promise.
1. If `this.[[state]]` is `"writable"`,
    1. Set `this.[[state]]` to `"waiting"`.
    1. Set `this.[[writablePromise]]` to be a newly-created pending promise.
    1. Call `this.[[doNextWrite]]({ type: "data", promise, data })`.
    1. Return `promise`.
1. If `this.[[state]]` is `"waiting"`,
    1. Push `{ type: "data", promise, data }` onto `this.[[buffer]]`.
    1. Return `promise`.
1. If `this.[[state]]` is `"closing"` or `"closed"`,
    1. Return a promise rejected with a `TypeError` exception.
1. If `this.[[state]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

###### close()

1. If `this.[[state]]` is `"writable"`,
    1. Set `this.[[state]]` to `"closing"`.
    1. Call `this.[[doClose]]()`.
    1. Return `this.[[closedPromise]]`.
1. If `this.[[state]]` is `"waiting"`,
    1. Set `this.[[state]]` to `"closing"`.
    1. Push `{ type: "close", promise: undefined, data: undefined }` onto `this.[[buffer]]`.
    1. Return `this.[[closedPromise]]`.
1. If `this.[[state]]` is `"closing"` or `"closed"`,
    1. Return a promise rejected with a `TypeError` exception.
1. If `this.[[state]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

###### abort(r)

1. If `this.[[state]]` is `"writable"`,
    1. Set `this.[[state]]` to `"closing"`.
    1. Return `this.[[doAbort]](r)`.
1. If `this.[[state]]` is `"waiting"`, or if `this.[[state]]` is `"closing"` and `this.[[buffer]]` is not empty,
    1. Set `this.[[state]]` to `"closing"`.
    1. For each entry `{ type, promise, data }` in `this.[[buffer]]`, reject `promise` with `r`.
    1. Clear `this.[[buffer]]`.
    1. Return `this.[[doAbort]](r)`.
1. Return a promise resolved with `undefined`.

###### wait()

1. Return `this.[[writablePromise]]`.

#### Internal Methods of BaseWritableStream

###### `[[error]](e)`

1. If `this.[[state]]` is not `"closed"` or `"errored"`,
    1. Reject `this.[[writablePromise]]` with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.
    1. For each entry `{ type, promise, data }` in `this.[[buffer]]`, reject `promise` with `r`.
    1. Set `this.[[storedError]]` to `e`.
    1. Set `this.[[state]]` to `"errored"`.

###### `[[doClose]]()`

1. Reject `this.[[writablePromise]]` with a `TypeError` exception.
1. Call `this.[[onClose]]()`.
1. If the call throws an exception `e`, call `this.[[error]](e)`.
1. Otherwise, let `closeResult` be the result of casting the return value to a promise.
1. When/if `closeResult` is fulfilled,
    1. Set `this.[[state]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
1. When/if `closeResult` is rejected with reason `r`, call `this.[[error]](r)`.

###### `[[doAbort]](r)`

1. Reject `this.[[writablePromise]]` with `r`.
1. Call `this.[[onAbort]](r)`.
1. If the call throws an exception `e`, call `this.[[error]](e)` and return a promise rejected with `e`.
1. Otherwise, let `abortResult` be the result of casting the return value to a promise.
1. When/if `abortResult` is fulfilled,
    1. Set `this.[[state]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with `undefined`.
1. When/if `abortResult` is rejected with reason `r`, call `this.[[error]](r)`.
1. Return `this.[[closedPromise]]`.

###### `[[doNextWrite]]({ type, promise, data })`

1. If `type` is `"close"`,
    1. Assert: `this.[[state]]` is `"closing"`.
    1. Call `this.[[doClose]]()`.
    1. Return.
1. Assert: `type` must be `"data"`.
1. Set `this.[[currentWritePromise]]` to `promise`.
1. Let `signalDone` be a new function of zero arguments, closing over `this` and `promise`, that performs the following steps:
    1. If `this.[[currentWritePromise]]` is not `promise`, return.
    1. Set `this.[[currentWritePromise]]` to `undefined`.
    1. If `this.[[state]]` is `"waiting"`,
        1. Resolve `promise` with `undefined`.
        1. If `this.[[buffer]]` is not empty,
            1. Shift `entry` off of `this.[[buffer]]`.
            1. Call `this.[[doNextWrite]](entry)`.
        1. If `this.[[buffer]]` is empty,
            1. Set `this.[[state]]` to `"writable"`.
            1. Resolve `this.[[writablePromise]]` with `undefined`.
    1. If `this.[[state]]` is `"closing"`,
        1. Resolve `promise` with `undefined`.
        1. If `this.[[buffer]]` is not empty,
            1. Shift `entry` off of `this.[[buffer]]`.
            1. Call `this.[[doNextWrite]](entry)`.
1. Call `this.[[onWrite]](data, signalDone, [[error]])`.
1. If the call throws an exception `e`, call `this.[[error]](e)`.

Note: if the constructor's `write` option calls `done` more than once, or after calling `error`, or after the stream has been aborted, then `signalDone` ends up doing nothing.

#### WritableStream

```js
class WritableStream extends BaseWritableStream {
    // Adds a backpressure strategy argument.
    constructor({
        function start = () => {},
        function write = () => {},
        function close = () => {},
        function abort = close,
        strategy: { function count, function needsMoreData }
    })

    // Overriden to take into account backpressure strategy
    Promise<undefined> write(data)

    // Overriden to take into account backpressure strategy.
    // You can also think of this as part of the the constructor and write override.
    [[doNextWrite]]({ type, promise, data })

    // Internal properties
    [[strategy]]
    [[bufferSize]] = 0
}
```

##### Properties of the WritableStream Prototype

###### constructor({ start, write, close, abort, strategy })

1. Set `this.[[strategy]]` to `strategy`.
1. Call `super({ start, write, close, abort })`.

###### write(data)

1. If `this.[[state]]` is `"writable"` or `"waiting"`,
    1. Add `this.[[strategy]].count(data)` to `this.[[bufferSize]]`.
1. If `this.[[state]]` is `"writable"`,
    1. Let `promise` be a newly-created pending promise.
    1. If `ToBoolean(this.[[strategy]].needsMoreData(this.[[bufferSize]]))` is `false`,
        1. Set `this.[[state]]` to `"waiting"`.
        1. Set `this.[[writablePromise]]` to be a newly-created pending promise.
    1. If `this.[[buffer]]` is empty,
        1. Call `this.[[doNextWrite]]({ type: "data", promise, data })`.
    1. Otherwise,
        1. Push `{ type: "data", promise, data }` onto `this.[[buffer]]`.
    1. Return `promise`.
1. Return `super(data)`.

##### Internal Methods of WritableStream

###### `[[doNextWrite]]({ type, promise, data })`

1. Subtract `this.[[strategy]].count(data)` from `this.[[bufferSize]]`.
1. Return the result of calling `BaseWritableStream`'s version of `this.[[doNextWrite]]({ type, promise, data })`.

#### CorkableWritableStream

```js
class CorkableWritableStream extends WritableStream {
    // Adds a writev argument.
    constructor({
        function start = () => {},
        function write = () => {},
        function writev = () => {},
        function close = () => {},
        function abort = close,
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

#### Subclassing Streams

Although functional by themselves for most cases, `ReadableStream`, `WritableStream`, and others can also be subclassed to provide additional functionality. Subclasses will generally fall into two camps:

- Additive subclasses, adding new APIs onto the stream instances. An example would be a file stream that includes `filename` or other filesystem-related properties, or a HTTP response stream that includes header-accessing APIs.
- Override subclasses, which change the behavior of the stream's methods fundamentally. An example would be a readable TCP stream that overrides `read`, `wait`, and `state` to reflect the status of kernel-level TCP buffer.

On an implementation level, additive subclasses will usually call `super` in their constructor, initializing their base class's internal buffer and accessing it through the provided parameters to their superconstructor. Whereas override subclasses will simply reimplement the appropriate methods directly, forgoing a call to `super` and all the internal state that comes with it. They will of course provide a new constructor, which does not pass the usual capability-accessing parameters to consumers.

Because streams only interact through their public API, both types of streams can coexist. For example, you can pipe to or from a subclassed stream of either sort, without worrying what type of implementation is under the covers, as long as the appropriate properties and methods are provided.

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
            abort(reason) {
                return Promise.all(this.[[outputs]].map(o => o.dest.abort(reason)));
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

## Acknowledgments

The editor would like to thank Bert Belder, Marcos Caceres, Tim Caswell, Forbes Lindesay, Thorsten Lorenz, Jens Nockert, Trevor Norris, Dominic Tarr, Takeshi Yoshino, and tzik for their contributions to this specification.

Special thanks to: Isaac Schlueter for his pioneering work on JavaScript streams in Node.js; Jake Verbaten for his continued involvement, support, and interest in pushing this spec forward; and Gorgi Kosev for his breakthrough idea of separating `pipe` into two methods, thus resolving a [major sticking point](https://github.com/whatwg/streams/issues/44).

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
