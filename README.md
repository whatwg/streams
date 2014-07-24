# Streams API

## Where Did All the Text Go?

We are in the process of transitioning this specification from a GitHub README into something a bit more palatable. The official-lookin' version is developed in the `index.bs` file and then deployed to the gh-pages branch; you can see it at https://whatwg.github.io/streams/.

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
        object strategy = new CountQueuingStrategy({ highWaterMark: 0 }),
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
    [[queue]]
    [[started]] = false
    [[draining]] = false
    [[pulling]] = false
    [[state]] = "waiting"
    [[storedError]]
    [[waitPromise]]
    [[closedPromise]]
    [[startedPromise]]

    // Holders for stuff given by the underlying source
    [[onCancel]]
    [[onPull]]
    [[strategy]]

    // Internal methods for use by the underlying source
    [[enqueue]](any chunk)
    [[close]]()
    [[error]](any e)

    // Other internal helper methods
    [[callOrSchedulePull]]()
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

##### constructor({ start, pull, cancel, strategy })

The constructor is passed several functions, all optional:

- `start(enqueue, close, error)` is typically used to adapt a push-based data source, as it is called immediately so it can set up any relevant event listeners, or to acquire access to a pull-based data source. If this process is asynchronous, it can return a promise to signal success or failure.
- `pull(enqueue, close, error)` is typically used to adapt a pull-based data source, as it is called in reaction to `read` calls, or to start the flow of data in push-based data sources. Once it is called, it will not be called again until its passed `enqueue` function is called.
- `cancel(reason)` is called when the readable stream is canceled, and should perform whatever source-specific steps are necessary to clean up and stop reading. If this process is asynchronous, it can return a promise to signal success or failure.

Both `start` and `pull` are given the ability to manipulate the stream's internal queue and state by being passed the `this.[[enqueue]]`, `this.[[close]]`, and `this.[[error]]` functions.

1. Set `this.[[onCancel]]` to `cancel`.
1. Set `this.[[onPull]]` to `pull`.
1. Set `this.[[strategy]]` to `strategy`.
1. Let `this.[[waitPromise]]` be a new promise.
1. Let `this.[[closedPromise]]` be a new promise.
1. Let `this.[[queue]]` be a new empty List.
1. Let _startResult_ be the result of `start(this.[[enqueue]], this.[[close]], this.[[error]])`.
1. ReturnIfAbrupt(_startResult_).
1. Let `this.[[startedPromise]]` be the result of resolving _startResult_ as a promise.
1. Upon fulfillment of `this.[[startedPromise]]`, set `this.[[started]]` to **true**.
1. Upon rejection of `this.[[startedPromise]]` with reason `r`, call `this.[[error]](r)`.

##### get state

1. Return `this.[[state]]`.

##### read()

1. If `this.[[state]]` is `"waiting"` or `"closed"`, throw a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`, throw `this.[[storedError]]`.
1. Assert: `this.[[state]]` is `"readable"`.
1. Assert: `this.[[queue]]` is not empty.
1. Let `chunk` be DequeueValue(`this.[[queue]]`).
1. If `this.[[queue]]` is now empty,
    1. If `this.[[draining]]` is **true**,
        1. Set `this.[[state]]` to `"closed"`.
        1. Let `this.[[waitPromise]]` be a new promise resolved with **undefined**.
        1. Resolve `this.[[closedPromise]]` with **undefined**.
    1. If `this.[[draining]]` is **false**,
        1. Set `this.[[state]]` to `"waiting"`.
        1. Let `this.[[waitPromise]]` be a new promise.
        1. Call `this.[[callOrSchedulePull]]()`.
1. Return `chunk`.

##### wait()

1. If `this.[[state]]` is `"waiting"`,
    1. Call `this.[[callOrSchedulePull]]()`.
1. Return `this.[[waitPromise]]`.

##### cancel(reason)

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. If `this.[[state]]` is `"waiting"`, resolve `this.[[waitPromise]]` with **undefined**.
1. If `this.[[state]]` is `"readable"`, let `this.[[waitPromise]]` be a new promise resolved with **undefined**.
1. Let `this.[[queue]]` be a new empty List.
1. Set `this.[[state]]` to `"closed"`.
1. Resolve `this.[[closedPromise]]` with **undefined**.
1. Return the result of promise-calling `this.[[onCancel]](reason)`.

##### get closed

1. Return `this.[[closedPromise]]`.

##### pipeTo(dest, { close })

The `pipeTo` method is one of the more complex methods, and is undergoing some revision and edge-case bulletproofing before we write it up in prose.

For now, please consider the reference implementation normative: [reference-implementation/lib/readable-stream.js](https://github.com/whatwg/streams/blob/master/reference-implementation/lib/readable-stream.js), look for the `pipeTo` method.

##### pipeThrough({ input, output }, options)

1. If Type(_input_) is not Object, then throw a **TypeError** exception.
1. If Type(_output_) is not Object, then throw a **TypeError** exception.
1. Let _stream_ be the **this** value.
1. Let _result_ be Invoke(_stream_, `"pipeTo"`, (_input_, _options_)).
1. ReturnIfAbrupt(_result_).
1. Return _output_.

#### Internal Methods of ReadableStream

##### `[[enqueue]](chunk)`

1. If `this.[[state]]` is `"errored"` or `"closed"`, return **false**.
1. Let _chunkSize_ be Invoke(`this.[[strategy]]`, `"size"`, (_chunk_)).
1. If _chunkSize_ is an abrupt completion,
    1. Call `this.[[error]](_chunkSize_.[[value]])`.
    1. Return **false**.
1. EnqueueValueWithSize(`this.[[queue]]`, `chunk`, _chunkSize_.[[value]]).
1. Set `this.[[pulling]]` to **false**.
1. Let _queueSize_ be GetTotalQueueSize(`this.[[queue]]`).
1. Let _needsMore_ be ToBoolean(Invoke(`this.[[strategy]]`, `"needsMore"`, (_queueSize_))).
1. If _needsMore_ is an abrupt completion,
    1. Call `this.[[error]](_needsMore_.[[value]])`.
    1. Return **false**.
1. If `this.[[state]]` is `"waiting"`,
    1. Set `this.[[state]]` to `"readable"`.
    1. Resolve `this.[[waitPromise]]` with **undefined**.
1. Return _needsMore_.[[value]].

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
    1. Let `this.[[queue]]` be a new empty List.
    1. Set `this.[[state]]` to `"errored"`.
    1. Set `this.[[storedError]]` to `e`.
    1. Let `this.[[waitPromise]]` be a new promise rejected with `e`.
    1. Reject `this.[[closedPromise]]` with `e`.

##### `[[callOrSchedulePull]]()`

1. If `this.[[pulling]]` is **true**, return.
1. Set `this.[[pulling]]` to **true**.
1. If `this.[[started]]` is **false**,
    1. Upon fulfillment of `this.[[startedPromise]]`, call `this.[[callPull]]`.
1. If `this.[[started]]` is **true**, call `this.[[callPull]]`.

##### `[[callPull]]()`

1. Let `pullResult` be the result of `this.[[onPull]](this.[[enqueue]], this.[[close]], this.[[error]])`.
1. If `pullResult` is an abrupt completion, call `this.[[error]](pullResult.[[value]])`.

## Writable Stream APIs

### WritableStream

```
class WritableStream {
    constructor({
        function start = () => {},
        function write = () => {},
        function close = () => {},
        function abort = close,
        object strategy = new CountQueuingStrategy({ highWaterMark: 0 })
    })

    // Writing data to the underlying sink
    Promise<undefined> write(any chunk)
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
    [[callOrScheduleAdvanceQueue]]()
    [[advanceQueue]]()
    [[syncStateWithQueue]]()
    [[doClose]]()

    // Internal slots
    [[queue]]
    [[started]] = false
    [[state]] = "writable"
    [[storedError]]
    [[currentWritePromise]]
    [[writablePromise]]
    [[closedPromise]]
    [[startedPromise]]

    // Holders for stuff given by the underlying sink
    [[onWrite]]
    [[onClose]]
    [[onAbort]]
    [[strategy]]
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

##### constructor({ start, write, close, abort, strategy })

The constructor is passed several functions, all optional:

* `start(error)` is called when the writable stream is created, and should open the underlying writable sink. If this process is asynchronous, it can return a promise to signal success or failure.
* `write(chunk, done, error)` should write `chunk` to the underlying sink. It can call its `done` or `error` parameters, either synchronously or asynchronously, to respectively signal that the underlying resource is ready for more data or that an error occurred writing. The stream implementation guarantees that this function will be called only after previous writes have succeeded (i.e. called their `done` parameter), and never after `close` or `abort` is called.
* `close()` should close the underlying sink. If this process is asynchronous, it can return a promise to signal success or failure. The stream implementation guarantees that this function will be called only after all queued-up writes have succeeded.
* `abort()` is an abrupt close, signaling that all data written so far is suspect. It should clean up underlying resources, much like `close`, but perhaps with some custom handling. Unlike `close`, `abort` will be called even if writes are queued up, throwing away those chunks. If this process is asynchronous, it can return a promise to signal success or failure.

In reaction to calls to the stream's `.write()` method, the `write` constructor option is given a chunk from the internal queue, along with the means to signal that the chunk has been successfully or unsuccessfully written.

1. Set `this.[[onWrite]]` to `write`.
1. Set `this.[[onClose]]` to `close`.
1. Set `this.[[onAbort]]` to `abort`.
1. Set `this.[[strategy]]` to `strategy`.
1. Let `this.[[writablePromise]]` be a new promise.
1. Let `this.[[closedPromise]]` be a new promise.
1. Let `this.[[queue]]` be a new empty List.
1. Let _startResult_ be the result of `start(this.[[error]])`.
1. ReturnIfAbrupt(_startResult_).
1. Let `this.[[startedPromise]]` be the result of resolving _startResult_ as a promise.
1. Upon fulfillment of `this.[[startedPromise]]`, set `this.[[started]]` to **true**.
1. Upon rejection of `this.[[startedPromise]]` with reason `r`, call `this.[[error]](r)`.

##### get closed

1. Return `this.[[closedPromise]]`.

##### get state

1. Return `this.[[state]]`.

##### write(chunk)

1. If `this.[[state]]` is `"waiting"` or `"writable"`,
    1. Let _chunkSize_ be Invoke(`this.[[strategy]]`, `"size"`, (_chunk_)).
    1. ReturnIfAbrupt(_chunkSize_).
    1. Let `promise` be a new promise.
    1. EnqueueValueWithSize(`this.[[queue]]`, Record{[[type]]: `"chunk"`, [[promise]]: `promise`, [[chunk]]: `chunk`}, _chunkSize_).
    1. Let _syncResult_ be `this.[[syncStateWithQueue]]()`.
    1. If _syncResult_ is an abrupt completion,
        1. Call `this.[[error]](syncResult.[[value]])`.
        1. Return `promise`.
    1. Call `this.[[callOrScheduleAdvanceQueue]]()`.
    1. Return `promise`.
1. If `this.[[state]]` is `"closing"` or `"closed"`,
    1. Return a promise rejected with a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`,
    1. Return a promise rejected with `this.[[storedError]]`.

##### close()

1. If `this.[[state]]` is `"closing"` or `"closed"`, return a promise rejected with a **TypeError** exception.
1. If `this.[[state]]` is `"errored"`, return a promise rejected with `this.[[storedError]]`.
1. If `this.[[state]]` is `"writable"`,
    1. Set `this.[[writablePromise]]` to a new promise rejected with a **TypeError** exception.
1. If `this.[[state]]` is `"waiting"`,
    1. Reject `this.[[writablePromise]]` with a **TypeError** exception.
1. Set `this.[[state]]` to `"closing"`.
1. EnqueueValueWithSize(`this.[[queue]]`, Record{[[type]]: `"close"`, [[promise]]: `this.[[closedPromise]]`, [[chunk]]: **undefined**}, **0**).
1. Call `this.[[callOrScheduleAdvanceQueue]]()`.
1. Return `this.[[closedPromise]]`.

##### abort(reason)

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. Call `this.[[error]](reason)`.
1. Return the result of promise-calling `this.[[onAbort]](reason)`.

##### wait()

1. Return `this.[[writablePromise]]`.

#### Internal Methods of WritableStream

##### `[[error]](e)`

1. If `this.[[state]]` is `"closed"` or `"errored"`, return.
1. Repeat while `this.[[queue]]` is not empty:
    1. Let `writeRecord` be DequeueValue(`this.[[queue]]`).
    1. Reject `writeRecord.[[promise]]` with `e`.
1. Set `this.[[currentWritePromise]]` to **undefined**.
1. Set `this.[[storedError]]` to `e`.
1. If `this.[[state]]` is `"writable"` or `"closing"`, set `this.[[writablePromise]]` to a new promise rejected with `e`.
1. If `this.[[state]]` is `"waiting"`, reject `this.[[writablePromise]]` with `e`.
1. Reject `this.[[closedPromise]]` with `e`.
1. Set `this.[[state]]` to `"errored"`.

##### `[[callOrScheduleAdvanceQueue]]()`

1. If `this.[[started]]` is **false**,
    1. Upon fulfillment of `this.[[startedPromise]]`, call `this.[[advanceQueue]]`.
1. If `this.[[started]]` is **true**, call `this.[[advanceQueue]]`.

##### `[[advanceQueue]]()`

1. If `this.[[queue]]` is empty, or `this.[[currentWritePromise]]` is not **undefined**, return.
1. Let `writeRecord` be PeekQueueValue(`this.[[queue]]`).
1. If `writeRecord.[[type]]` is `"close"`,
    1. Assert: `this.[[state]]` is `"closing"`.
    1. DequeueValue(`this.[[queue]]`).
    1. Assert: `this.[[queue]]` is empty.
    1. Call `this.[[doClose]]()`.
1. Otherwise,
    1. Assert: `writeRecord.[[type]]` is `"chunk"`.
    1. Set `this.[[currentWritePromise]]` to `writeRecord.[[promise]]`.
    1. Let `signalDone` be a new function of zero arguments, closing over `this` and `writeRecord.[[promise]]`, that performs the following steps:
        1. If `this.[[currentWritePromise]]` is not `writeRecord.[[promise]]`, return.
        1. Set `this.[[currentWritePromise]]` to **undefined**.
        1. Resolve `writeRecord.[[promise]]` with **undefined**.
        1. DequeueValue(`this.[[queue]]`).
        1. Let _syncResult_ be `this.[[syncStateWithQueue]]()`.
        1. If _syncResult_ is an abrupt completion, then
            1. Call `this.[[error]](syncResult.[[value]])`.
            1. Return.
        1. Call `this.[[advanceQueue]]()`.
    1. Call `this.[[onWrite]](chunk, signalDone, this.[[error]])`.
    1. If the call throws an exception `e`, call `this.[[error]](e)`.

Note: if the constructor's `write` option calls `done` more than once, or after calling `error`, or after the stream has been aborted, then `signalDone` ends up doing nothing, since `this.[[currentWritePromise]]` is no longer equal to `writeRecord.[[promise]]`.

Note: the peeking-then-dequeuing dance is necessary so that during the call to the user-supplied function, `this.[[onWrite]]`, the queue and corresponding public `state` property correctly reflect the ongoing write. The write record only leaves the queue after a call to `signalDone` tells us that the chunk has been successfully written to the underlying sink, and we can advance the queue.

##### `[[syncStateWithQueue]]()`

1. If `this.[[state]]` is `"closing"`, return.
1. Assert: `this.[[state]]` is either `"writable"` or `"waiting"`.
1. If `this.[[state]]` is `"waiting"` and `this.[[queue]]` is empty,
    1. Set `this.[[state]]` to `"writable"`.
    1. Resolve `this.[[writablePromise]]` with **undefined**.
    1. Return.
1. Let _queueSize_ be GetTotalQueueSize(`this.[[queue]]`).
1. Let _needsMore_ be Invoke(`this.[[strategy]]`, `"needsMore"`, (_queueSize_)).
1. ReturnIfAbrupt(_needsMore_).
1. Let _needsMore_ be ToBoolean(_needsMore_).
1. ReturnIfAbrupt(_needsMore_).
1. If _needsMore_ is **true** and `this.[[state]]` is `"waiting"`,
    1. Set `this.[[state]]` to `"writable"`.
    1. Resolve `this.[[writablePromise]]` with **undefined**.
1. If _needsMore_ is **false** and `this.[[state]]` is `"writable"`,
    1. Set `this.[[state]]` to `"waiting"`.
    1. Set `this.[[writablePromise]]` to a new promise.

##### `[[doClose]]()`

1. Assert: `this.[[state]]` is `"closing"`.
1. Let _closePromise_ be the result of promise-calling `this.[[onClose]]()`.
1. Upon fulfillment of _closePromise_,
    1. Set `this.[[state]]` to `"closed"`.
    1. Resolve `this.[[closedPromise]]` with **undefined**.
1. Upon rejection of _closePromise_ with reason _r_,
    1. Call `this.[[error]](r)`.

## Helper APIs

### TeeStream

A "tee stream" is a writable stream which, when written to, itself writes to multiple destinations. It aggregates backpressure and abort signals from those destinations, propagating the appropriate aggregate signals backward.

```js
class TeeStream extends WritableStream {
    constructor() {
        this.[[outputs]] = [];

        super({
            write(chunk) {
                return Promise.all(this.[[outputs]].map(o => o.dest.write(chunk)));
            },
            close() {
                const outputsToClose = this.[[outputs]].filter(o => o.close);
                return Promise.all(outputsToClose.map(o => o.dest.close()));
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

    size(chunk) {
        return chunk.byteLength;
    }

    needsMore(queueSize) {
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

    size(chunk) {
        return 1;
    }

    needsMore(queueSize) {
        return queueSize < this.highWaterMark;
    }
}
```

## Queue-with-Sizes Operations

The streams in this specification use a "queue-with-sizes" data structure to store queued up values, along with their determined sizes. A queue-with-sizes is a List of records with [[value]] and [[size]] fields (although in implementations it would of course be backed by a more efficient data structure).

A number of operations are used to make working with queues-with-sizes more pleasant:

### EnqueueValueWithSize ( _queue_, _value_, _size_ )

1. Let _size_ be ToNumber(_size_).
1. ReturnIfAbrupt(_size_).
1. If _size_ is **NaN**, throw a **TypeError** exception.
1. Append Record{[[value]]: _value_, [[size]]: _size_} as the last element of _queue_.

### DequeueValue ( _queue_ )

1. Assert: _queue_ is not empty.
1. Let _pair_ be the first element of _queue_.
1. Remove _pair_ from _queue_, shifting all other elements downward (so that the second becomes the first, and so on).
1. Return _pair_.[[value]].

### PeekQueueValue ( _queue_ )

1. Assert: _queue_ is not empty.
1. Let _pair_ be the first element of _queue_.
1. Return _pair_.[[value]].

### GetTotalQueueSize ( _queue_ )

1. Let _totalSize_ be **0**.
1. Repeat for each Record{[[value]], [[size]]} _pair_ that is an element of _queue_,
    1. Assert: _pair_.[[size]] is a valid, non-**NaN** number.
    1. Add _pair_.[[size]] to _totalSize_.
1. Return _totalSize_.
