# Streams API

## Abstract

The streams API provides an interface for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and buffering. They provide an [extensible web](http://extensiblewebmanifesto.org/) toolbox upon which higher-level abstractions can be built, such as filesystem or socket APIs, while at the same time users can use the supplied tools to build their own streaming abstractions.

Both low-level generic streams, with customizable buffering strategy, and high-level binary and string streams, with high water marks providing a built-in buffering strategy, are described. The latter is of course built on top of the former.

## Status

This specification is undergoing heavy revision. The most useful product right now is the [requirements document](Requirements.md), which show what a useful stream API must solve. It contains a [list of APIs](#stream-apis-overview) that address these requirements, but most of them are not fully fleshed out yet.

In terms of concrete APIs, the [`BaseReadableStream`](#basereadablestream) class is fairly complete, with its internal state machine entirely specified. The [`BaseWritableStream`](#basewritablestream)'s definition is given, but its behavior is still being translated from my head to this repository. The building blocks and higher-level abstractions mentioned in the toolbox are not yet specified in detail.

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
    - Has a very simple backpressure strategy, communicating to the underlying data source that it should stop supplying data immediately after it pushes some onto the stream's underlying buffer. (In other words, it has a "high water mark" of zero.)
    - Support piping to only one destination.
- `ReadableStream`
    - A higher-level API used by most creators of readable streams.
    - Adds the ability to customize the buffering and backpressure strategy, overriding the basic one.
    - Supports piping to more than one destination, by using the `TeeStream` transform stream within its `pipe` method.

#### WritableStreams

- `BaseWritableStream`
    - Has a very simple backpressure strategy, communicating that it is "full" immediately after any data is written (but becoming ready to write again after the asynchronous write completes).
- `WritableStream`
    - A higher-level API used by most creators of writable streams.
    - Adds the ability to customize the buffering and backpressure strategy, overriding the basic one.

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

## Readable Stream APIs

### BaseReadableStream

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
    any [[error]]
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
    "readable" // buffer has something in it; read at will
    "waiting"  // buffer is empty; call waitForReadable
    "finished" // no more data available
    "errored"  // reading from the stream errored so the stream is now dead
}
```

#### Internal Methods of BaseReadableStream

##### `[[push]](data)`

1. If `[[readableState]]` is `"waiting"`,
    1. Push `data` onto `[[buffer]]`.
    1. Set `[[pulling]]` to `false`.
    1. Resolve `[[readablePromise]]` with `undefined`.
    1. Set `[[readableState]]` to `"readable"`.
1. If `[[readableState]]` is `"readable"`,
    1. Push `data` onto `[[buffer]]`.
    1. Set `[[pulling]]` to `false`.

##### `[[finish]]()`

1. If `[[readableState]]` is `"waiting"`,
    1. Reject `[[readablePromise]]` with an error saying that the stream has already been completely read.
    1. Resolve `[[finishedPromise]]` with `undefined`.
    1. Set `[[readableState]]` to `"finished"`.
1. If `[[readableState]]` is `"readable"`,
    1. Set `[[draining]]` to `true`.

##### `[[error]](e)`

1. If `[[readableState]]` is `"waiting"`,
    1. Set `[[error]]` to `e`.
    1. Reject `[[finishedPromise]]` with `e`.
    1. Reject `[[readablePromise]]` with `e`.
    1. Set `[[readableState]]` to `"errored"`.
1. If `[[readableState]]` is `"readable"`,
    1. Clear `[[buffer]]`.
    1. Set `[[error]]` to `e`.
    1. Let `[[readablePromise]]` be a newly-created promise object rejected with `e`.
    1. Reject `[[finishedPromise]]` with `e`.
    1. Set `[[readableState]]` to `"errored"`.

##### `[[callPull]]()`

1. If `[[pulling]]` is `true`, return.
1. If `[[started]]` is `false`,
    1. When/if `[[startedPromise]]` is fulfilled, call `[[onPull]]([[push]], [[finish]], [[error]])`.
1. If `[[started]]` is `true`,
    1. Call `[[onPull]]([[push]], [[finish]], [[error]])`.

#### Properties of the BaseReadableStream prototype

##### constructor({ start, pull, abort })

The constructor is passed several functions, all optional:

- `start(push, finish, error)` is typically used to adapting a push-based data source, as it is called immediately so it can set up any relevant event listeners, or to acquire access to a pull-based data source.
- `pull(push, finish, error)` is typically used to adapt a pull-based data source, as it is called in reaction to `read` calls, or to start the flow of data in push-based data sources. Once it is called, it will not be called again until its passed `push` function is called.
- `abort(reason)` is called when the readable stream is aborted, and should perform whatever source-specific steps are necessary to clean up and stop reading. It is given the abort reason that was given to the stream when calling the public `abort` method, if any.

Both `start` and `pull` are given the ability to manipulate the stream's internal buffer and state by being passed the `[[push]]`, `[[finish]]`, and `[[error]]` functions.

1. Set `[[onAbort]]` to `abort`.
1. Set `[[onPull]]` to `pull`.
1. Let `[[readablePromise]]` be a newly-created promise object.
1. Let `[[finishedPromise]]` be a newly-created promise object.
1. Call `start([[push]], [[finish]], [[error]])` and let `[[startedPromise]]` be the result of casting the return value to a promise.
1. When/if `[[startedPromise]]` is fulfilled, set `[[started]]` to `true`.
1. When/if `[[startedPromise]]` is rejected with reason `r`, call `[[error]](r)`.

##### get readableState

1. Return `[[readableState]]`.

##### read()

1. If `[[readableState]]` is `"waiting"`,
    1. Throw an error indicating that the stream does not have any data available yet.
1. If `[[readableState]]` is `"readable"`,
    1. Assert: `[[buffer]]` is not empty.
    1. Let `data` be the result of shifting an element off of the front of `[[buffer]]`.
    1. If `[[buffer]]` is now empty,
        1. If `[[draining]]` is `true`,
            1. Resolve `[[finishedPromise]]` with `undefined`.
            1. Let `[[readablePromise]]` be a newly-created promise rejected with an error saying that the stream has already been completely read.
            1. Set `[[readableState]]` to `"finished"`.
        1. If `[[draining]]` is `false`,
            1. Set `[[readableState]]` to `"waiting"`.
            1. Let `[[readablePromise]]` be a newly-created pending promise.
            1. `[[callPull]]()`.
    1. Return `data`.
1. If `[[readableState]]` is `"errored"`,
    1. Throw `[[error]]`.
1. If `[[readableState]]` is `"finished"`,
    1. Throw an error indicating that the stream has already been completely read.

##### waitForReadable()

1. If `[[readableState]]` is `"waiting"`,
    1. `[[callPull]]()`.
1. Return `[[readablePromise]]`.

##### abort(reason)

1. If `[[readableState]]` is `"waiting"`,
    1. Call `[[onAbort]](reason)`.
    1. Resolve `[[finishedPromise]]` with `undefined`.
    1. Reject `[[readablePromise]]` with `reason`.
    1. Set `[[readableState]]` to `"finished"`.
1. If `[[readableState]]` is `"readable"`,
    1. Call `[[onAbort]](reason)`.
    1. Resolve `[[finishedPromise]]` with `undefined`.
    1. Let `[[readablePromise]]` be a newly-created promise rejected with `reason`.
    1. Clear `[[buffer]]`.
    1. Set `[[readableState]]` to `"finished"`.

##### get finished

1. Return `[[finishedPromise]]`.

##### pipe(dest, { close })

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

### ReadableStream

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

    // Internal tee stream used by pipe
    [[tee]] = undefined
}
```

#### Internal Methods of ReadableStream

##### `[[push]](data)`

1. Call `BaseReadableStream`'s version of `[[push]](data)`.
1. If `[[readableState]]` is now `"readable"`,
    1. Add `[[strategy]].count(data)` to `[[bufferSize]]`.
    1. Return `[[strategy]].needsMoreData([[bufferSize]])`.

#### Properties of the ReadableStream Prototype

##### `constructor({ start, pull, abort, strategy })`

1. Set `[[strategy]]` to `strategy`.
1. Call `super({ start, pull, abort })`.

##### `read()`

1. Let `data` be `super()`.
1. Subtract `[[strategy]].count(data)` from `[[bufferSize]]`.
1. Return `data`.

##### `pipe(dest, { close })`

1. Let `alreadyPiping` be `true`.
1. If `[[tee]]` is `undefined`, let `[[tee]]` be a new `TeeStream` and set `alreadyPiping` to `false`.
1. Call `[[tee]].addOut(dest, { close })`.
1. If `alreadyPiping` is `false`, call `super([[tee]], { close: true })`.
1. Return `dest`.

### Example Usage

Although the by-far most common way of consuming a readable stream will be to pipe it to a writable stream, it is useful to see some examples to understand how the underlying primitives work. For example, this function writes the contents of a readable stream to the console as fast as it can. Note that it because of how our reading API is designed, there is no asynchronous delay imposed if data chunks are available immediately, or several chunks are available in sequence.

```js
function streamToConsole(readable) {
    pump();

    function pump() {
        while (readable.readableState === "readable") {
            console.log(readable.read());
        }

        if (readable.readableState === "finished") {
            console.log("--- all done!");
        } else {
            // If we're in an error state, the returned promise will be rejected with that error,
            // so no need to handle "waiting" vs. "errored" separately.
            readable.waitForReadable().then(pump, e => console.error(e));
        }
    }
}
```

As another example, this helper function will return a promise for the next available piece of data from a given readable stream. This introduces an artificial delay if there is already data buffered, but can provide a convenient interface for simple chunk-by-chunk consumption, as one might do e.g. when streaming database records.

```js
function getNext(readable) {
    return new Promise((resolve, reject) => {
        if (readable.readableState === "waiting") {
            resolve(readable.waitForReadable().then(() => readable.read()));
        } else {
            // If the state is `"errored"` or `"finished"`, the appropriate error will be thrown,
            // which by the semantics of the Promise constructor causes the desired rejection.
            resolve(readable.read());
        }
    });
}

// Usage with a promise-generator bridge like Q or TaskJS:
Q.spawn(function* () {
    while (myStream.readableState !== "finished") {
        const data = yield getNext(myStream);
        // do something with `data`.
    }
});
```

As a final example, this function uses the reading APIs to buffer the entire stream in memory and give a promise for the results, defeating the purpose of streams but educating us while doing so:

```js
function readableStreamToArray(readable) {
    return new Promise((resolve, reject) => {
        var chunks = [];

        readable.finished.then(() => resolve(chunks), reject);
        pump();

        function pump() {
            while (readable.readableState === "readable") {
                chunks.push(readable.read());
            }

            if (readable.readableState === "waiting") {
                readable.waitForReadable().then(pump);
            }

            // All other cases will go through `readable.finished.then(...)` above.
        }
    });
}
```

### Example Creation

As mentioned, it is important for a readable stream API to be able to support both push- and pull-based data sources. We give one example of each.

#### Adapting a Push-Based Data Source

In general, a push-based data source can be modeled as:

- A `readStart` method that starts the flow of data
- A `readStop` method that sends an advisory signal to stop the flow of data
- A `ondata` handler that fires when new data is pushed from the source
- A `onend` handler that fires when the source has no more data
- A `onerror` handler that fires when the source signals an error getting data

As an aside, this is pretty close to the existing HTML [`WebSocket` interface](http://www.whatwg.org/specs/web-apps/current-work/multipage/network.html#the-websocket-interface), with the exception that `WebSocket` does not give any method of pausing or resuming the flow of data.

Let's assume we have some raw C++ socket object or similar, which presents the above API. The data it delivers via `ondata` comes in the form of `ArrayBuffer`s. We wish to create a class that wraps that C++ interface into a stream, with a configurable high-water mark set to a reasonable default. This is how you would do it:

```js
class StreamingSocket extends ReadableStream {
    constructor(host, port, { highWaterMark = 16 * 1024 } = {}) {
        const rawSocket = createRawSocketObject(host, port);
        super({
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
            },

            abort() {
                rawSocket.readStop();
            },

            strategy: {
                count(incomingArrayBuffer) {
                    return incomingArrayBuffer.length;
                },

                needsMoreData(bufferSize) {
                    return bufferSize < highWaterMark;
                }
            }
        });
    }
}
```

By leveraging the `ReadableStream` base class, and supplying its super-constructor with the appropriate adapter functions and backpressure strategy, we've created a fully-functioning stream wrapping our raw socket API. It will automatically fill the internal buffer as data is fired into it, preventing any loss that would occur in the simple evented model. If the buffer fills up to the high water mark (defaulting to 16 KiB), it will send a signal to the underlying socket that it should stop sending us data. And once the consumer drains it of all its data, it will send the start signal back, resuming the flow of data.

Note how, if data is available synchronously because `ondata` was called synchronously, the data is immediately pushed into the internal buffer and available for consumption by any downstream consumers. Similarly, if `ondata` is called twice in a row, the pushed data will be available to two subsequent `readableStream.read()` calls before `readableStream.readableState` becomes `"waiting"`.

#### Adapting a Pull-Based Data Source

In general, a pull-based data source can be modeled as:

- An `open(cb)` method that gains access to the source; it can call `cb` either synchronous or asynchronously, with either `(err)` or `(null)`.
- A `read(cb)` function method that gets data from the source; can call `cb` either synchronously or asynchronously, with either `(err, null, null)` or `(null, true, null)` indicating there is no more data or `(null, false, data)` indicating there is data.
- A `close()` method that releases access to the source (necessary to call only if all data has not already been read).

Let's assume that we have some raw C++ file handle API matching this type of setup. Here is how we would adapt that into a readable stream:

```js
class ReadableFile extends ReadableStream {
    constructor(filename, { highWaterMark = 16 * 1024 } = {}) {
        const fileHandle = createRawFileHandle(filename);

        super({
            start(push, finish, error) {
                return new Promise(resolve => {
                    fileHandle.open(err => {
                        if (err) {
                            error(err);
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
                        finish();
                    } else {
                        push(data);
                    }
                });
            },

            abort() {
                fileHandle.close();
            },

            strategy: {
                count(incomingArrayBuffer) {
                    return incomingArrayBuffer.length;
                },

                needsMoreData(bufferSize) {
                    return bufferSize < highWaterMark;
                }
            }
        });
    }
}
```

As before, we leverage the `ReadableStream` base class to do most of the work. Our adapter functions, in this case, don't set up event listeners as they would for a push source; instead, they directly forward the desired operations of opening the file handle and reading from it down to the underlying API.

Again note how, if data is available synchronously because `fileHandle.read` called its callback synchronously, that data is immediately pushed into the internal buffer and available for consumption by any downstream consumers. And if data is requested from the `ReadableFile` instance twice in a row, it will immediately forward those requests to the underlying file handle, so that if it is ready synchronously (because e.g. the OS has recently buffered this file in memory), the data will be returned instantly, within that same turn.

## Writable Stream APIs

### BaseWritableStream

Writable streams are a bit simpler than readable streams, but still are complicated by the need to buffer fast writes.

```
class BaseWritableStream {
    constructor({
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
}

enum WritableStreamState {
    "writable" // buffer is not yet full; write at will
    "waiting"  // buffer is full; you should call waitForWritable
    "closed"   // underlying sink has been closed; no more writing
    "errored"  // writing to the stream errored so the stream is now dead
}
```

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
