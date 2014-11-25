# Streams API Binary Extension

## Readable Byte Stream API

This extended API allows efficient access to a data source available for read via the POSIX non-blocking `read(2)` API or similar.

We map the non-blocking `read(2)` to a non-blocking method `ReadableByteStream.prototype.readInto()`, and asynchronous notification of I/O events to the state and Promises.

`ReadableByteStream` has the same states as the `ReadableStream`. State transition happens on `notifyReady()` call and on calling `readInto()` of the underlying source.

When a `ReadableByteStream` is constructed, the underlying source watches for events on the file descriptor from which data is read using some I/O event loop built with `select(2)`, `poll(2)`, etc. `ReadableByteStream` provides a function `notifyReady()` to the underlying source. It is intended to be called when the file descriptor is ready. It moves the stream into the `"readable"` state. The `"readable"` state doesn't necessarily mean some bytes are available for read. It just means that `ReadableByteStream.prototype.readInto()` can be called. We need to call `read(2)` to know what kind of event has actually happened (new data available for read or the EOF or an error), so we enter `"readable"` and let the user call `readInto()`.

`ReadableByteStream`'s constructor takes `readInto()` function from the underlying source instead of taking `pull()` and providing `[[enqueue]]`. A user calls `ReadableByteStream.prototype.readInto()` with an ArrayBuffer prepared by the user to get available data written into the ArrayBuffer. The method calls the `readInto()` of the underlying source with the ArrayBuffer. `readInto()` calls `read(2)` to write read data directly onto the ArrayBuffer. The stream translates the return value of the function into the next state of the stream and returns the number of bytes written to the given ArrayBuffer as follows:

- If there are bytes available for read,
    - The underlying source's `readInto()` should write the bytes into the ArrayBuffer and return the number of bytes written.
    - Then, the stream stays in the `"readable"` state and `stream.readInto()` will return the number of bytes written.
- If the file descriptor has nothing available for non-blocking read, e.g. `read(2)` returning `EAGAIN`, `EWOULDBLOCK`, etc.,
    - The underlying source's `readInto()` should write nothing into the ArrayBuffer and return -2.
    - Then, the stream enters the `"waiting"` state and `stream.readInto()` will return 0.
- If the file descriptor reached the EOF,
    - The underlying source's `readInto()` should write nothing into the ArrayBuffer and return -1.
    - Then, the stream enters the `"closed"` state and `stream.readInto()` will return 0.
- If the `read(2)` fails,
    - The underlying source's `readInto()` should write nothing into the ArrayBuffer and throw.
    - Then, the stream enters the `"errored"` state and `stream.readInto()` will return 0.

By admitting returning the ArrayBuffer with no data written on it, `ReadableByteStream` satisfies the semantics of `ReadableStream`.

### ReadableByteStream

```
class ReadableByteStream {
    constructor({
        function start = () => {},
        function readInto = () => {},
        function cancel() => {},
        readBufferSize = undefined
    })

    any readInto(arrayBuffer, offset, size)
    void cancel(any reason)

    get ReadableStreamState state

    get Promise<undefined> ready
    get Promise<undefined> closed

    // Internal slots
    [[state]] = "waiting"
    [[storedError]]

    [[readyPromise]]
    [[closedPromise]]

    // Holders for stuff given by the underlying source
    [[onReadInto]]
    [[onCancel]]

    // Internal methods for use by the underlying source
    [[notifyReady]]()
    [[error]](any e)
}
```

#### Abstract Operations For ReadableByteStream Objects

##### Notify Ready Function

A notify ready function is an anonymous built-in function that has [[Stream]] internal slot.

When a notify ready function _F_ is called, the following steps are taken:

1. Let _stream_ be the value of _F_'s [[Stream]] internal slot.
1. If _stream_.[[state]] is not `"waiting"`, return.
1. Set _stream_.[[state]] to `"readable"`.
1. Resolve _stream_.[[readyPromise]] with **undefined**.

##### ErrorReadableByteStream( stream, error )

1. If _stream_.[[state]] is `"errored"` or `"closed"`, return.
1. If _stream_.[[state]] is `"waiting"`, reject _stream_.[[readyPromise]] with _error_.
1. If _stream_.[[state]] is `"readable"`, let _stream_.[[readyPromise]] be a new promise rejected with _error_.
1. Set _stream_.[[state]] to `"errored"`.
1. Set _stream_.[[storedError]] to _error_.
1. Reject _stream_.[[closedPromise]] with _error_.

##### Error Function

An error function is an anonymous built-in function that has [[Stream]] internal slot.

When an error function _F_ is called with argument _error_, the following steps are taken:

1. Let _stream_ be the value of _F_'s [[Stream]] internal slot.
1. ErrorReadableByteStream(_stream_, _error_).

#### Properties of the ReadableByteStream Prototype Object

##### constructor({ start, readInto, cancel, readBufferSize })

1. Let _stream_ be the **this** value.
1. If IsCallable(_start_) is false, then throw a **TypeError** exception.
1. If IsCallable(_readInto_) is false, then throw a **TypeError** exception.
1. If IsCallable(_cancel_) is false, then throw a **TypeError** exception.
1. If _readBufferSize_ is not **undefined**,
    1. Let _readBufferSize_ be ToInteger(_readBufferSize_).
    1. If _readBufferSize_ < 0, throw a **RangeError** exception.
1. Set _stream_.[[onReadInto]] to _readInto_.
1. Set _stream_.[[onCancel]] to _cancel_.
1. Set _stream_.[[readBufferSize]] to _readBufferSize_.
1. Let _stream_.[[readyPromise]] be a new promise.
1. Let _stream_.[[closedPromise]] be a new promise.
1. Let _stream_.[[notifyReady]] be a new built-in function object as defined in Notify Ready Function with [[Stream]] internal slot set to _stream_.
1. Let _stream_.[[error]] be a new built-in function object as defined in Error Function with [[Stream]] internal slot set to _stream_.
1. Let _startResult_ be the result of calling the [[Call]] internal method of _start_ with **undefined** as _thisArgument_ and (_stream_.[[notifyReady]], _stream_.[[error]]) as _argumentList_.
1. ReturnIfAbrupt(_startResult_).

##### ReadableByteStream.prototype.read ()

1. If **this**.[[readBufferSize]] is **undefined**, throw a **TypeError** exception.
1. Let _arrayBuffer_ be a new array buffer with length equals to **this**.[[readBufferSize]].
1. Let _bytesRead_ be Invoke(**this**, `"readInto"`, (_arrayBuffer_, 0, **this**.[[readBufferSize]])).
1. Let _resizedArrayBuffer_ be a new array buffer with length equal to _bytesRead_ created by transferring _arrayBuffer_ using the semantics of [the proposed `ArrayBuffer.transfer`](https://gist.github.com/andhow/95fb9e49996615764eff).
1. Return _resizedArrayBuffer_.

##### ReadableByteStream.prototype.readInto ( arrayBuffer, offset, size )

1. If **this**.[[state]] is `"waiting"` or `"closed"`, throw a **TypeError** exception.
1. If **this**.[[state]] is `"errored"`, throw **this**.[[storedError]].
1. Assert: **this**.[[state]] is `"readable"`.
1. If Type(_arrayBuffer_) is not Object, throw a **TypeError** exception.
1. If _arrayBuffer_ does not have an [[ArrayBufferData]] internal slot, throw a **TypeError** exception.
1. If the value of _arrayBuffer_'s [[ArrayBufferData]] internal slot is **undefined**, then throw a **TypeError** exception.
1. If IsNeuteredBuffer(_arrayBuffer_) is **true**, then throw a **TypeError** exception.
1. Let _bufferLength_ be the value of _arrayBuffer_'s [[ArrayBufferByteLength]] internal slot.
1. If _offset_ is **undefined**, let _offset_ be 0.
1. Otherwise,
    1. Let _offset_ be ToInteger(_offset_).
    1. ReturnIfAbrupt(_offset_).
    1. If _offset_ < 0, throw a **RangeError** exception.
1. If _size_ is **undefined**, let _size_ be _bufferLength_ - _offset_.
1. Otherwise,
    1. Let _size_ be ToInteger(_size_).
    1. ReturnIfAbrupt(_size_).
1. If _size_ < 0 or _offset_ + _size_ > _bufferLength_, throw a **RangeError** exception.
1. Let _bytesRead_ be the result of calling the [[Call]] internal method of **this**.[[onReadInto]] with **undefined** as _thisArgument_ and (_arrayBuffer_, _offset_, _size_) as _argumentsList_.
1. If _bytesRead_ is an abrupt completion,
    1. ErrorReadableByteStream(**this**, _bytesRead_.[[value]]).
    1. Return _bytesRead_.
1. Let _bytesRead_ be ToNumber(_bytesRead_).
1. If _bytesRead_ is **NaN** or _bytesRead_ < -2 or _bytesRead_ > _bufferLength_,
    1. Let _error_ be a **RangeError** exception.
    1. ErrorReadableByteStream(**this**, _error_).
    1. Throw _error_.
1. If _bytesRead_ is -2,
    1. Set **this**.[[state]] to `"waiting"`.
    1. Let **this**.[[readyPromise]] be a new promise.
    1. Return 0.
1. If _bytesRead_ is -1,
    1. Set **this**.[[state]] to `"closed"`
    1. Resolve **this**.[[closedPromise]] with **undefined**.
    1. Return 0.
1. Return _bytesRead_.

##### ReadableByteStream.prototype.cancel ( reason )

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. If `this.[[state]]` is `"waiting"`, resolve `this.[[readyPromise]]` with **undefined**.
1. Set `this.[[state]]` to `"closed"`.
1. Resolve `this.[[closedPromise]]` with **undefined**.
1. Let _cancelPromise_ be a new promise.
1. Let _sourceCancelPromise_ be the result of promise-calling **this**.\[\[onCancel]](_reason_).
1. Upon fulfillment of _sourceCancelPromise_, resolve _cancelPromise_ with **undefined**.
1. Upon rejection of _sourceCancelPromise_ with reason _r_, reject _cancelPromise_ with _r_.
1. Return _cancelPromise_.

##### get ReadableByteStream.prototype.state

1. Let _stream_ be the **this** value.
1. Return _stream_.[[state]].

##### get ReadableByteStream.prototype.ready

1. Let _stream_ be the **this** value.
1. Return _stream_.[[readyPromise]].

##### get ReadableByteStream.prototype.closed

1. Let _stream_ be the **this** value.
1. Return _stream_.[[closedPromise]].
