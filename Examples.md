# Streams API Examples

Although some examples are given in-line with the specification, they are generally focused on a specific aspect being discussed, and are not complete examples of how you might use streams in a real application.

This document fleshes out those examples, adding more code and commentary to each, and includes new examples focused on scenarios not necessary to explain the spec. It is meant to be standalone, so an astute reader will notice some text duplication with the specification.

## Readable Streams

### Usage

#### Pumping a Stream To the Console

Although the by-far most common way of consuming a readable stream will be to pipe it to a writable stream, it is useful to see some examples to understand how the underlying primitives work. For example, this function writes the contents of a readable stream to the console as fast as it can. Note that it because of how our reading API is designed, there is no asynchronous delay imposed if chunks are available immediately, or several chunks are available in sequence.

```js
function streamToConsole(readable) {
    readable.closed.then(
        () => console.log("--- all done!"),
        e => console.error(e);
    );

    pump();

    function pump() {
        while (readable.state === "readable") {
            console.log(readable.read());
        }

        if (readable.state === "waiting") {
            readable.ready.then(pump);
        }

        // Otherwise the stream is "closed" or "errored", which will be handled above.
    }
}
```

#### Getting the Next Piece of Available Data

As another example, this helper function will return a promise for the next available piece of data from a given readable stream. This introduces an artificial delay if there is already data queued, but can provide a convenient interface for simple chunk-by-chunk consumption, as one might do e.g. when streaming database records. It uses an EOF sentinel to signal the end of the stream, and behaves poorly if called twice in parallel without waiting for the previously-returned promise to fulfill.

```js
var EOF = Object.create(null);

function getNext(stream) {
    if (stream.state === "closed") {
        return Promise.resolve(EOF);
    }

    return stream.ready.then(function () {
        if (stream.state === "closed") {
            return EOF;
        }

        // If stream is "errored", this will throw, causing the promise to be rejected.
        return stream.read();
    });
}

// Usage with a promise-generator bridge like Q or TaskJS:
Q.spawn(function* () {
    while ((const chunk = yield getNext(myStream)) !== EOF) {
        // do something with `chunk`.
    }
});
```

#### Buffering the Entire Stream Into Memory

As a final example, this function uses the reading APIs to buffer the entire stream in memory and give a promise for the results, defeating the purpose of streams but educating us while doing so:

```js
function readableStreamToArray(readable) {
    var chunks = [];

    pump();
    return readable.closed.then(() => chunks);

    function pump() {
        while (readable.state === "readable") {
            chunks.push(readable.read());
        }

        if (readable.state === "waiting") {
            readable.ready.then(pump);
        }

        // Otherwise the stream is "closed" or "errored", which will be handled above.
    }
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
            start(enqueue, finish, error) {
                rawSocket.ondata = chunk => {
                    if (!enqueue(chunk)) {
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

            strategy: new ByteLengthQueuingStrategy({ highWaterMark })
        });
    }
}

const mySocketStream = new StreamingSocket("http://example.com", 80);
```

By leveraging the `ReadableStream` base class, and supplying its super-constructor with the appropriate adapter functions and backpressure strategy, we've created a fully-functioning stream wrapping our raw socket API. It will automatically fill the internal queue as data is fired into it, preventing any loss that would occur in the simple evented model. If the queue fills up to the high water mark (defaulting to 16 KiB), it will send a signal to the underlying socket that it should stop sending us data. And once the consumer drains it of all its data, it will send the start signal back, resuming the flow of data.

Note how, if data is available synchronously because `ondata` was called synchronously, the data is immediately enqueued into the internal queue and available for consumption by any downstream consumers. Similarly, if `ondata` is called twice in a row, the enqueued data will be available to two subsequent `readableStream.read()` calls before `readableStream.state` becomes `"waiting"`.

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

            pull(enqueue, finish, error) {
                fileHandle.read((err, done, chunk) => {
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
                        enqueue(chunk);
                    }
                });
            },

            abort() {
                fileHandle.close();
            },

            strategy: new ByteLengthQueuingStrategy({ highWaterMark })
        });
    }
}

const myFileStream = new ReadableFile("/example/path/on/fs.txt");
```

As before, we leverage the `ReadableStream` base class to do most of the work. Our adapter functions, in this case, don't set up event listeners as they would for a push source; instead, they directly forward the desired operations of opening the file handle and reading from it down to the underlying API.

Again note how, if data is available synchronously because `fileHandle.read` called its callback synchronously, that data is immediately enqueued into the internal queue and available for consumption by any downstream consumers. And if data is requested from the `ReadableFile` instance twice in a row, it will immediately forward those requests to the underlying file handle, so that if it is ready synchronously (because e.g. the OS has recently buffered this file in memory), the chunk will be returned instantly, within that same turn of the event loop.

## Writable Streams

### Usage

#### Writing as Fast as You Can

Since writable streams will automatically queue any incoming writes, taking care to send the data to the underlying sink in sequence, you can indiscriminately write to a writable stream without much ceremony:

```js
function writeArrayToStream(array, writableStream) {
    array.forEach(function (chunk) {
        writableStream.write(chunk);
    });

    return writableStream.close();
}

writeArrayToStream([1, 2, 3, 4, 5], myStream)
    .then(() => console.log("All done!"))
    .catch(e => console.error("Error with the stream: " + e));
```

Note how, even though a given call to `write` returns a promise signaling the success or failure of a given write, we don't need to wait for success before writing the next chunk; the underlying implementation will ensure that this happens for us. Similarly, we don't need to attach a rejection handler to the promise returned from each `write` call, since any errors that occur along the way will cause the writing process to abort and thus `close()` will return that error.

#### Reporting Incremental Progress

Even if we queue up all our writes immediately, we can still add handlers to report when they succeed or fail.

```js
function writeArrayToStreamWithReporting(array, writableStream) {
    array.forEach(function (chunk) {
        writableStream.write(chunk)
            .then(() => console.log("Wrote " + chunk + " successfully"))
            .catch(e => console.error("Failed to write " + chunk + "; error was " + e));
    });

    return writableStream.close();
}

writeArrayToStream([1, 2, 3], myStream)
    .then(() => console.log("All done!"))
    .catch(e => console.error("Error with the stream: " + e));
```

Let's say `myStream` was able to successfully write all of the chunks. Then you'd get an output like:

```
Wrote 1 successfully
Wrote 2 successfully
Wrote 3 successfully
All done!
```

Whereas, let's say it was able to write chunk 1, but failed to write chunk 2, giving an error of `"Disk full"`. In that case, the call to `write` for chunk 3 would also fail with this error, as would the call to `close`:

```
Wrote 1 successfully
Failed to write 2; error was "Disk full"
Failed to write 3; error was "Disk full"
Error with the stream: "Disk full"
```

#### Paying Attention to Backpressure Signals

The above two examples used the writable streams internal queue to indiscriminately write to it, counting on the stream itself to handle an excessive number of writes (i.e., more than could be reasonably written to the underlying sink). In reality, the underlying sink will be communicating backpressure signals back to you through the writable stream's `state` property. When the stream's `state` property is `"writable"`, the stream is ready to accept more data—but when it is `"waiting"`, you should, if possible, avoid writing more data.

It's a little hard to come up with a realistic example where you can do something useful with this information, since most of them involve readable streams, and in that case, you should just be piping the streams together. But here's one that's only slightly contrived, where we imagine prompting the user for input via a promise-returning `prompt()` function—and disallowing the user from entering more input until the writable stream is ready to accept it.

```js
function promptAndWrite(myStream) {
    if (writableStream.state === "writable") {
        prompt("Enter data to write to the stream").then(chunk => {
            if (chunk !== "DONE") {
                writableStream.write(chunk);
                promptAndWrite();
            } else {
                writableStream.close()
                    .then(() => console.log("Successfully closed"))
                    .catch(e => console.error("Failed to close: ", e));
            }
        });
    } else if (writableStream.state === "waiting") {
        console.log("Waiting for the stream to flush to the underlying sink, please hold...");
        writableStream.ready.then(promptAndWrite);
    } else if (writableStream.state === "errored") {
        console.error("Error writing; this session is over!");
    }
}

promptAndWrite(myStream);
```


### Creation

Writable streams are generally easier to wrap around their underlying sinks than readable ones are around their underlying sources, since you don't have to deal with the push-vs.-pull dichotomy.

#### Adapting a Generic Data Sink

In general, a data sink can be modeled as:

* An `open(cb)` method that gains access to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.
* A `write(chunk, cb)` method that writes `chunk` to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`. Importantly, it will fail if you call it indiscriminately; you must wait for the callback to come back—possibly synchronously—with a success before calling it again.
* A `close(cb)` method that releases access to the sink; it can call `cb` either synchronously or asynchronously, with either `(err)` or `(null)`.

Let's assume we have some raw C++ file handle API matching this type of setup. Here is how we would adapt that into a writable stream:

````js
class WritableFile extends WritableStream {
    constructor(filename, { highWaterMark = 16 * 1024} = {}) {
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

            write(chunk) {
                return new Promise((resolve, reject) => {
                    fileHandle.write(chunk, err => {
                        if (err) {
                            fileHandle.close(closeErr => {
                                if (closeErr) {
                                    reject(closeErr);
                                }
                                reject(err);
                            });
                        }
                        resolve();
                    });
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
            },

            strategy: new ByteLengthQueuingStrategy({ highWaterMark })
        });
    }
}

var file = new WritableFile("/example/path/on/fs.txt");
```

As you can see, this is fairly straightforward: we simply supply constructor parameters that adapt the raw file handle API into an expected form. The writable stream's internal mechanisms will take care of the rest, ensuring that these supplied operations are queued and sequenced correctly when a consumer writes to the resulting writable stream. Most of the boilerplate here comes from adapting callback-based APIs into promise-based ones, really.

Note how backpressure signals are given off by a writable stream. If a particular call to `fileHandle.write` takes a longer time, the returned promise will be resolved later. In the meantime, users of the writable stream may have queued up additional writes, which are stored in the stream's internal queue. The accumulation of this queue can move the stream into a "waiting" state, according to the `strategy` parameter, which is a signal to users of the stream that they should back off and stop writing if possible—as seen in our above usage examples.
