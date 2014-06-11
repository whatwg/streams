# Streams API

## Where Did All the Text Go?

We are in the process of transitioning this specification from a GitHub README into something a bit more palatable. The official-lookin' version is developed in the `index.html` file, which you can see [on GitHub](https://github.com/whatwg/streams/blob/master/index.html), or in its rendered glory at [this long URL](http://anolis.hoppipolla.co.uk/aquarium.py/output?uri=http%3A%2F%2Frawgithub.com%2Fwhatwg%2Fstreams%2Fmaster%2Findex.html&process_filter=on&process_toc=on&process_xref=on&process_sub=on&process_annotate=on&filter=&annotation=&newline_char=LF&tab_char=SPACE&min_depth=2&max_depth=6&w3c_compat_xref_a_placement=on&parser=lxml.html&serializer=html5lib&output_encoding=ascii).

Right now, we've transferred over most of the concepts and text, but none of the algorithms or APIs. We'll be iterating on the APIs a bit more here, in Markdown format, until we feel confident in them. In the meantime, please check out the rendered spec for all of the interesting stage-setting text.

By the way, this transition is being tracked as [#62](https://github.com/whatwg/streams/issues/62).

## Readable Stream APIs

### ReadableStream

```
class ReadableStream {
    constructor({
        function start = () => {},
        function pull = () => {},
        function cancel = () => {},
        { function count = () => 0, function needsMoreData = () => false } = {}
    })

    // Reading data from the underlying source
    any read()
    Promise<undefined> wait()
    get ReadableStreamState state

    // Composing with other streams
    WritableStream pipeTo(WritableStream dest, { ToBoolean close = true } = {})
    ReadableStream pipeThrough({ WritableStream in, ReadableStream out }, options)

    // Stop accumulating data
    void cancel(any reason)

    // Useful helper
    get Promise<undefined> closed

    // Internal slots
    [[queue]] = []
    [[started]] = false
    [[draining]] = false
    [[pulling]] = false
    [[state]] = "waiting"
    [[storedError]]
    [[waitPromise]]
    [[closedPromise]]
    [[startedPromise]]
    [[onCancel]]
    [[onPull]]
    [[queueSize]] = 0
    [[strategyCount]]
    [[strategyNeedsMoreData]]

    // Internal methods for use by the underlying source
    [[push]](any data)
    [[close]]()
    [[error]](any e)

    // Other internal helper methods
    [[callPull]]()
}

enum ReadableStreamState {
    "readable"  // the queue has something in it; read at will
    "waiting"   // the source is not ready or the queue is empty; you should call wait
    "closed"  // all data has been read from both the source and the queue
    "errored"   // the source errored so the stream is now dead
}
```

#### Properties of the ReadableStream prototype

##### constructor({ start, pull, cancel, { count, needsMoreData } })

The constructor is passed several functions, all optional:

- `start(push, close, error)` is typically used to adapt a push-based data source, as it is called immediately so it can set up any relevant event listeners, or to acquire access to a pull-based data source.
- `pull(push, close, error)` is typically used to adapt a pull-based data source, as it is called in reaction to `read` calls, or to start the flow of data in push-based data sources. Once it is called, it will not be called again until its passed `push` function is called.
- `cancel()` is called when the readable stream is canceled, and should perform whatever source-specific steps are necessary to clean up and stop reading.

Both `start` and `pull` are given the ability to manipulate the stream's internal queue and state by being passed the `this.[[push]]`, `this.[[close]]`, and `this.[[error]]` functions.

1. Set `this.[[onCancel]]` to `cancel`.
1. Set `this.[[onPull]]` to `pull`.
1. Set `this.[[strategyCount]]` to `count`.
1. Set `this.[[strategyNeedsMoreData]]` to `needsMoreData`.
1. Let `this.[[waitPromise]]` be a newly-created pending promise.
1. Let `this.[[closedPromise]]` be a newly-created pending promise.
1. Let _startResult_ be the result of `start(this.[[push]], this.[[close]], this.[[error]])`.
1. ReturnIfAbrupt(_startResult_).
1. Let `this.[[startedPromise]]` be the result of casting _startResult_ to a promise.
1. Upon fulfillment of `this.[[startedPromise]]`, set `this.[[started]]` to **true**.
1. Upon rejection of `this.[[startedPromise]]` with reason `r`, call `this.[[error]](r)`.

##### get state

1. Return `this.[[state]]`.

##### read()

1. If `this.[[state]]` is `"waiting"` or `"closed"`, throw a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`, throw `this.[[storedError]]`.
1. Assert: `this.[[state]]` is `"readable"`.
1. Assert: `this.[[queue]]` is not empty.
1. Let `{ data, dataCount }` be the result of shifting an element off of the front of `this.[[queue]]`.
1. Let `this.[[queueSize]]` be `this.[[queueSize]] - dataCount`.
1. If `this.[[queue]]` is now empty,
    1. If `this.[[draining]]` is **true**,
        1. Set `this.[[state]]` to `"closed"`.
        1. Let `this.[[waitPromise]]` be a newly-created promise resolved with **undefined**.
        1. Resolve `this.[[closedPromise]]` with **undefined**.
    1. If `this.[[draining]]` is **false**,
        1. Set `this.[[state]]` to `"waiting"`.
        1. Let `this.[[waitPromise]]` be a newly-created pending promise.
        1. Call `this.[[callPull]]()`.
1. Return `data`.

##### wait()

1. If `this.[[state]]` is `"waiting"`,
    1. Call `this.[[callPull]]()`.
1. Return `this.[[waitPromise]]`.

##### cancel()

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. If `this.[[state]]` is `"waiting"`, resolve `this.[[waitPromise]]` with **undefined**.
1. If `this.[[state]]` is `"readable"`, let `this.[[waitPromise]]` be a new promise resolved with **undefined**.
1. Clear `this.[[queue]]`.
1. Set `this.[[state]]` to `"closed"`.
1. Resolve `this.[[closedPromise]]` with **undefined**.
1. Return the result of promise-calling `this.[[onCancel]]()`.

##### get closed

1. Return `this.[[closedPromise]]`.

##### pipeTo(dest, { close })

```js
ReadableStream.prototype.pipeTo = (dest, { close = true } = {}) => {
    const source = this;
    close = Boolean(close);

    fillDest();
    return dest;

    function fillDest() {
        if (dest.state === "writable") {
            pumpSource();
        } else if (dest.state === "waiting") {
            dest.wait().then(fillDest, cancelSource);
        } else {
            // Source has either been closed by someone else, or has errored in the course of
            // someone else writing. Either way, we're not going to be able to do anything
            // else useful.
            cancelSource();
        }
    }

    function pumpSource() {
        if (source.state === "readable") {
            dest.write(source.read()).catch(cancelSource);
            fillDest();
        } else if (source.state === "waiting") {
            source.wait().then(fillDest, abortDest);
        } else if (source.state === "closed") {
            closeDest();
        } else {
            abortDest();
        }
    }

    function cancelSource(reason) {
        source.cancel(reason);
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

##### pipeThrough({ input, output }, options)

1. If Type(_input_) is not Object, then throw a **TypeError** exception.
1. If Type(_output_) is not Object, then throw a **TypeError** exception.
1. Let _stream_ be the **this** value.
1. Let _result_ be the result of calling Invoke(_stream_, `"pipeTo"`, (_input_, _options_)).
1. ReturnIfAbrupt(_result_).
1. Return _output_.

#### Internal Methods of ReadableStream

##### `[[push]](data)`

1. If `this.[[state]]` is `"waiting"` or `"readable"`,
    1. Let _dataCount_ be the result of `this.[[strategyCount]](data)`.
    1. ReturnIfAbrupt(_dataCount_).
    1. Push `{ data, dataCount }` onto `this.[[queue]]`.
    1. Let `this.[[queueSize]]` be `this.[[queueSize]] + dataCount`.
    1. Set `this.[[pulling]]` to **false**.
1. If `this.[[state]]` is `"waiting"`
    1. Set `this.[[state]]` to `"readable"`.
    1. Resolve `this.[[waitPromise]]` with **undefined**.
    1. Return **true**.
1. If `this.[[state]]` is `"readable"`,
    1. Return the result of `this.[[strategyNeedsMoreData]](this.[[queueSize]])`.
1. Return **false**.

##### `[[close]]()`

1. If `this.[[state]]` is `"waiting"`,
    1. Resolve `this.[[waitPromise]]` with **undefined**.
    1. Resolve `this.[[closedPromise]]` with **undefined**.
    1. Set `this.[[state]]` to `"closed"`.
1. If `this.[[state]]` is `"readable"`,
    1. Set `this.[[draining]]` to **true**.

##### `[[error]](e)`

1. If `this.[[state]]` is `"waiting"`,
    1. Set `this.[[state]]` to `"errored"`.
    1. Set `this.[[storedError]]` to `e`.
    1. Reject `this.[[waitPromise]]` with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.
1. If `this.[[state]]` is `"readable"`,
    1. Clear `this.[[queue]]`.
    1. Set `this.[[state]]` to `"errored"`.
    1. Set `this.[[storedError]]` to `e`.
    1. Let `this.[[waitPromise]]` be a newly-created promise object rejected with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.

##### `[[callPull]]()`

1. If `this.[[pulling]]` is **true**, return.
1. Set `this.[[pulling]]` to **true**.
1. If `this.[[started]]` is **false**,
    1. Upon fulfillment of `this.[[startedPromise]]`,
        1. Let `pullResult` be the result of `this.[[onPull]](this.[[push]], this.[[close]], this.[[error]])`.
        1. If `pullResult` is an abrupt completion, call `this.[[error]](pullResult.[[value]])`.
1. If `this.[[started]]` is **true**,
    1. Let `pullResult` be the result of `this.[[onPull]](this.[[push]], this.[[close]], this.[[error]])`.
    1. If `pullResult` is an abrupt completion, call `this.[[error]](pullResult.[[value]])`.

## Writable Stream APIs

### WritableStream

```
class WritableStream {
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
    [[advanceQueue]]()
    [[doClose]]()
    [[doNextWrite]]({ type, promise, data })

    // Internal slots
    [[queue]] = []
    [[state]] = "writable"
    [[storedError]]
    [[currentWritePromise]]
    [[writablePromise]]
    [[closedPromise]]
    [[onWrite]]
    [[onClose]]
    [[onAbort]]
    [[queueSize]] = 0
    [[strategyCount]]
    [[strategyNeedsMoreData]]
}

enum WritableStreamState {
    "writable" // the sink is ready and the queue is not yet full; write at will
    "waiting"  // the sink is not ready or the queue is full; you should call wait
    "closing"  // the sink is being closed; no more writing
    "closed"   // the sink has been closed
    "errored"  // the sink errored so the stream is now dead
}
```

#### Properties of the WritableStream prototype

##### constructor({ start, write, close, abort, { count, needsMoreData } })

The constructor is passed several functions, all optional:

* `start()` is called when the writable stream is created, and should open the underlying writable sink. If this process is asynchronous, it can return a promise to signal success or failure.
* `write(data, done, error)` should write `data` to the underlying sink. It can call its `done` or `error` parameters, either synchronously or asynchronously, to respectively signal that the underlying resource is ready for more data or that an error occurred writing. The stream implementation guarantees that this function will be called only after previous writes have succeeded (i.e. called their `done` parameter), and never after `close` or `abort` is called.
* `close()` should close the underlying sink. If this process is asynchronous, it can return a promise to signal success or failure. The stream implementation guarantees that this function will be called only after all queued-up writes have succeeded.
* `abort()` is an abrupt close, signaling that all data written so far is suspect. It should clean up underlying resources, much like `close`, but perhaps with some custom handling. Unlike `close`, `abort` will be called even if writes are queued up, throwing away that data.

In reaction to calls to the stream's `.write()` method, the `write` constructor option is given data from the internal queue, along with the means to signal that the data has been successfully or unsuccessfully written.

1. Set `this.[[onWrite]]` to `write`.
1. Set `this.[[onClose]]` to `close`.
1. Set `this.[[onAbort]]` to `abort`.
1. Set `this.[[strategyCount]]` to `count`.
1. Set `this.[[strategyNeedsMoreData]]` to `needsMoreData`.
1. Let `this.[[writablePromise]]` be a newly-created pending promise.
1. Let `this.[[closedPromise]]` be a newly-created pending promise.
1. Call `start()` and let `startedPromise` be the result of casting the return value to a promise.
1. When/if `startedPromise` is fulfilled, call `this.[[advanceQueue]]()`.
1. When/if `startedPromise` is rejected with reason `r`, call `this.[[error]](r)`.

##### get closed

1. Return `this.[[closedPromise]]`.

##### get state

1. Return `this.[[state]]`.

##### write(data)

1. If `this.[[state]]` is `"waiting"`,
    1. Let _dataCount_ be the result of `this.[[strategyCount]](data)`.
    1. ReturnIfAbrupt(_dataCount_).
    1. Let `promise` be a newly-created pending promise.
    1. Push `{ type: "data", promise, data, dataCount }` onto `this.[[queue]]`.
    1. Let `this.[[queueSize]]` be `this.[[queueSize]] + dataCount`.
    1. Return `promise`.
1. If `this.[[state]]` is `"writable"`,
    1. Let _dataCount_ be the result of `this.[[strategyCount]](data)`.
    1. ReturnIfAbrupt(_dataCount_).
    1. Let `promise` be a newly-created pending promise.
    1. If `this.[[queue]]` is empty, call `this.[[doNextWrite]]({ type: "data", promise, data })`.
    1. Otherwise,
        1. Let _needsMoreData_ be the result of `this.[[strategyNeedsMoreData]](this.[[queueSize]])`.
        1. ReturnIfAbrupt(_needsMoreData_).
        1. If ToBoolean(_needsMoreData_) is **false**,
            1. Set `this.[[state]]` to `"waiting"`.
            1. Set `this.[[writablePromise]]` to be a newly-created pending promise.
        1. Push `{ type: "data", promise, data, dataCount }` onto `this.[[queue]]`.
        1. Let `this.[[queueSize]]` be `this.[[queueSize]] + dataCount`.
    1. Return `promise`.
1. If `this.[[state]]` is `"closing"` or `"closed"`,
    1. Return a promise rejected with a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

##### close()

1. If `this.[[state]]` is `"writable"`,
    1. Set `this.[[state]]` to `"closing"`.
    1. Call `this.[[doClose]]()`.
    1. Return `this.[[closedPromise]]`.
1. If `this.[[state]]` is `"waiting"`,
    1. Set `this.[[state]]` to `"closing"`.
    1. Push `{ type: "close", promise: undefined, data: undefined }` onto `this.[[queue]]`.
    1. Return `this.[[closedPromise]]`.
1. If `this.[[state]]` is `"closing"` or `"closed"`,
    1. Return a promise rejected with a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

##### abort(reason)

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. Call `this.[[error]](reason)`.
1. Return the result of promise-calling `this.[[onAbort]]()`.

##### wait()

1. Return `this.[[writablePromise]]`.

#### Internal Methods of WritableStream

##### `[[error]](e)`

1. If `this.[[state]]` is `"closed"` or `"errored"`, return.
1. For each entry `{ type, promise, data }` in `this.[[queue]]`, reject `promise` with `r`.
1. Clear `this.[[queue]]`.
1. Set `this.[[state]]` to `"errored"`.
1. Set `this.[[storedError]]` to `e`.
1. Reject `this.[[writablePromise]]` with `e`.
1. Reject `this.[[closedPromise]]` with `e`.

##### `[[advanceQueue]]()`

1. If `this.[[queue]]` is not empty,
    1. Shift `entry` off of `this.[[queue]]`.
    1. Let `this.[[queueSize]]` be `this.[[queueSize]] - entry.dataCount`.
    1. Call `this.[[doNextWrite]](entry)`.
1. If `this.[[queue]]` is empty,
    1. Set `this.[[state]]` to `"writable"`.
    1. Resolve `this.[[writablePromise]]` with **undefined**.

##### `[[doClose]]()`

1. Reject `this.[[writablePromise]]` with a **TypeError** exception.
1. Let _closePromise_ be the result of promise-calling `this.[[onClose]]()`.
1. Upon fulfillment of _closePromise_,
    1. Set `this.[[state]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with **undefined**.
1. Upon rejection of _closePromise_ with reason _r_,
    1. Call `this.[[error]](r)`.

##### `[[doNextWrite]]({ type, promise, data })`

1. If `type` is `"close"`,
    1. Assert: `this.[[state]]` is `"closing"`.
    1. Call `this.[[doClose]]()`.
    1. Return.
1. Assert: `type` must be `"data"`.
1. Set `this.[[currentWritePromise]]` to `promise`.
1. Let `signalDone` be a new function of zero arguments, closing over `this` and `promise`, that performs the following steps:
    1. If `this.[[currentWritePromise]]` is not `promise`, return.
    1. Set `this.[[currentWritePromise]]` to **undefined**.
    1. If `this.[[state]]` is `"waiting"`,
        1. Resolve `promise` with **undefined**.
        1. Call `this.[[advanceQueue]]()`.
    1. If `this.[[state]]` is `"closing"`,
        1. Resolve `promise` with **undefined**.
        1. If `this.[[queue]]` is not empty,
            1. Shift `entry` off of `this.[[queue]]`.
            1. Let `this.[[queueSize]]` be `this.[[queueSize]] - entry.dataCount`.
            1. Call `this.[[doNextWrite]](entry)`.
1. Call `this.[[onWrite]](data, signalDone, this.[[error]])`.
1. If the call throws an exception `e`, call `this.[[error]](e)`.

Note: if the constructor's `write` option calls `done` more than once, or after calling `error`, or after the stream has been aborted, then `signalDone` ends up doing nothing.

## Helper APIs

### TeeStream

A "tee stream" is a writable stream which, when written to, itself writes to multiple destinations. It aggregates backpressure and abort signals from those destinations, propagating the appropriate aggregate signals backward.

```js
class TeeStream extends WritableStream {
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

### ByteLengthQueuingStrategy

A common queuing strategy when dealing with binary data is to wait until the accumulated `byteLength` properties of the incoming data reaches a specified `highWaterMark`. As such, this is provided as a built-in helper along with the stream APIs.

```js
class ByteLengthQueuingStrategy {
    constructor({ highWaterMark }) {
        this.highWaterMark = Number(highWaterMark);

        if (Number.isNaN(this.highWaterMark) || this.highWaterMark < 0) {
            throw new RangeError("highWaterMark must be a nonnegative number.");
        }
    }

    count(chunk) {
        return chunk.byteLength;
    }

    needsMoreData(queueSize) {
        return queueSize < this.highWaterMark;
    }
}
```

### CountQueuingStrategy

A common queuing strategy when dealing with object streams is to simply count the number of objects that have been accumulated so far, waiting until this number reaches a specified `highWaterMark`. As such, this strategy is also provided as a built-in helper.

```js
class CountQueuingStrategy {
    constructor({ highWaterMark }) {
        this.highWaterMark = Number(highWaterMark);

        if (Number.isNaN(this.highWaterMark) || this.highWaterMark < 0) {
            throw new RangeError("highWaterMark must be a nonnegative number.");
        }
    }

    count(chunk) {
        return 1;
    }

    needsMoreData(queuSize) {
        return queueSize < this.highWaterMark;
    }
}
```
