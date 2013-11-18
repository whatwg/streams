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
- `lengthBufferingStrategy`
    - A buffering strategy that uses the `length` property of incoming objects to compute how they contribute to reaching the designated high water mark.
    - Useful mostly for streams of `ArrayBuffer`s and strings.
- `countBufferingStrategy`
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
        while (dest.writableState === "writable") {
            pumpSource();
        }

        if (dest.writableState === "waiting") {
            dest.waitForWritable().then(fillDest, abortSource);
        } else {
            // Source has either been closed by someone else, or has errored in the course of
            // someone else writing. Either way, we're not going to be able to do anything
            // else useful.
            abortSource();
        }
    }

    function pumpSource() {
        while (source.readableState === "readable") {
            dest.write(source.read()).catch(abortSource);
        }

        if (source.readableState === "waiting") {
            source.waitForReadable().then(pump, disposeDest);
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

#### Example Usage

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

#### Example Creation

As mentioned, it is important for a readable stream API to be able to support both push- and pull-based data sources. We give one example of each.

```js
function pushSourceToReadableStream(source) {
    // Assume a generic push source as in the Requirements section:
    // `readStart`, `readStop`, `ondata`, `onend`, `onerror`.

    return new BaseReadableStream({
        start(push, finish, error) {
            source.ondata = chunk => {
                if (!push(chunk)) {
                    source.readStop();
                }
            };

            source.onend = finish;

            source.onerror = error;
        },

        pull() {
            source.readStart();
        },

        abort() {
            source.readStop();
        }
    });
}
```

```js
function pullSourceToReadableStream(source) {
    // Assume a generic pull source as in the Requirements section:
    // `open(cb)`, `read(cb)`, `close()`.

    return new BaseReadableStream({
        start(push, finish, error) {
            return new Promise(resolve => {
                open(err => {
                    if (err) {
                        error(err);
                    }
                    resolve();
                }
            });
        },

        pull(push, finish, error) {
            read((err, done, data) => {
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
            close();
        }
    });
}
```

Note how in both cases, if data is available synchronously (e.g. because `ondata` or `read` are called synchronously), the data is immediately pushed into the internal buffer and available for consumption by any downstream consumers. Similarly, if data is pushed from the push source twice in a row, it will be available to two subsequent `readableStream.read()` calls before `readableStream.readableState` becomes `"waiting"`. And if data is requested from the readable stream wrapping the pull source twice in a row, it will immediately forward those requests to the underlying pull source, so that if it is ready synchronously, the data will be returned.

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
