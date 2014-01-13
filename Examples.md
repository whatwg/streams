# Streams API Examples

Although some examples are given in-line with the specification, they are generally focused on a specific aspect being discussed, and are not complete examples of how you might use streams in a real application.

This document fleshes out those examples, adding more code and commentary to each, and includes new examples focused on scenarios not necessary to explain the spec. It is meant to be standalone, so an astute reader will notice some text duplication with the specification.

## Readable Streams

### Usage

#### Pumping a Stream To the Console

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

#### Getting the Next Piece of Available Data

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

#### Buffering the Entire Stream Into Memory

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

readableStreamToArray(myStream).then(chunks => {
    console.log("Number of chunks:", chunks.length);
    console.log("First chunk:", chunks[0]);
    console.log("Last chunk:", chunks[chunks.length - 1]);
})
```

### Creation

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

            strategy: new LengthBufferingStrategy({ highWaterMark })
        });
    }
}

const mySocketStream = new StreamingSocket("http://example.com", 80);
```

By leveraging the `ReadableStream` base class, and supplying its super-constructor with the appropriate adapter functions and backpressure strategy, we've created a fully-functioning stream wrapping our raw socket API. It will automatically fill the internal buffer as data is fired into it, preventing any loss that would occur in the simple evented model. If the buffer fills up to the high water mark (defaulting to 16 KiB), it will send a signal to the underlying socket that it should stop sending us data. And once the consumer drains it of all its data, it will send the start signal back, resuming the flow of data.

Note how, if data is available synchronously because `ondata` was called synchronously, the data is immediately pushed into the internal buffer and available for consumption by any downstream consumers. Similarly, if `ondata` is called twice in a row, the pushed data will be available to two subsequent `readableStream.read()` calls before `readableStream.readableState` becomes `"waiting"`.

#### Adapting a Pull-Based Data Source

In general, a pull-based data source can be modeled as:

- An `open(cb)` method that gains access to the source; it can call `cb` either synchronous or asynchronously, with either `(err)` or `(null)`.
- A `read(cb)` function method that gets data from the source; can call `cb` either synchronously or asynchronously, with either `(err, null, null)` indicating an error, or `(null, true, null)` indicating there is no more data, or `(null, false, data)` indicating there is data.
- A `close(cb)` method that releases access to the source; can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.

Let's assume that we have some raw C++ file handle API matching this type of setup. Here is how we would adapt that into a readable stream:

```js
class ReadableFile extends ReadableStream {
    constructor(filename, { highWaterMark = 16 * 1024 } = {}) {
        const fileHandle = createRawFileHandle(filename);

        super({
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
            },

            abort() {
                fileHandle.close();
            },

            strategy: new LengthBufferingStrategy({ highWaterMark })
        });
    }
}

const myFileStream = new ReadableFile("/example/path/on/fs.txt");
```

As before, we leverage the `ReadableStream` base class to do most of the work. Our adapter functions, in this case, don't set up event listeners as they would for a push source; instead, they directly forward the desired operations of opening the file handle and reading from it down to the underlying API.

Again note how, if data is available synchronously because `fileHandle.read` called its callback synchronously, that data is immediately pushed into the internal buffer and available for consumption by any downstream consumers. And if data is requested from the `ReadableFile` instance twice in a row, it will immediately forward those requests to the underlying file handle, so that if it is ready synchronously (because e.g. the OS has recently buffered this file in memory), the data will be returned instantly, within that same turn of the event loop.
