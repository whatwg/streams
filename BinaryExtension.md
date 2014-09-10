# Streams API Binary Extension

## Readable Byte Stream API

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

    get Promise<undefined> wait
    get Promise<undefined> closed

    // Internal slots
    [[state]] = "waiting"
    [[storedError]]

    [[waitPromise]]
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

##### ReadIntoArrayBuffer( stream, arrayBuffer, offset, size )

1. If _stream_.[[state]] is `"waiting"` or `"closed"`, throw a **TypeError** exception.
1. If _stream_.[[state]] is `"errored"`, throw _stream_.[[storedError]].
1. Assert: _stream_.[[state]] is `"readable"`.
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
1. Let _bytesRead_ be the result of calling the [[Call]] internal method of _stream_.[[onReadInto]] with **undefined** as _thisArgument_ and (_arrayBuffer_, _offset_, _size_) as _argumentsList_.
1. If _bytesRead_ is an abrupt completion,
    1. ErrorReadableByteStream(_stream_, _bytesRead_.[[value]]).
    1. Return _bytesRead_.
1. Let _bytesRead_ be ToNumber(_bytesRead_).
1. If _bytesRead_ is **NaN** or _bytesRead_ < -2 or _bytesRead_ > _bufferLength_,
    1. Let _error_ be a **RangeError** exception.
    1. ErrorReadableByteStream(_stream_, _error_).
    1. Throw _error_.
1. If _bytesRead_ is -2,
    1. Set _stream_.[[state]] to `"waiting"`.
    1. Let _stream_.[[waitPromise]] be a new promise.
    1. Return 0.
1. If _bytesRead_ is -1,
    1. Set _stream_.[[state]] to `"closed"`
    1. Resolve _stream_.[[closedPromise]] with **undefined**.
    1. Return 0.
1. Return _bytesRead_.

##### Notify Ready Function

A notify ready function is an anonymous built-in function that has [[Stream]] internal slot.

When a notify ready function _F_ is called, the following steps are taken:

1. Let _stream_ be the value of _F_'s [[Stream]] internal slot.
1. If _stream_.[[state]] is not `"waiting"`, return.
1. Set _stream_.[[state]] to `"readable"`.
1. Resolve _stream_.[[waitPromise]] with **undefined**.

##### ErrorReadableByteStream( stream, error )

1. If _stream_.[[state]] is `"errored"` or `"closed"`, return.
1. If _stream_.[[state]] is `"waiting"`, reject _stream_.[[waitPromise]] with _error_.
1. If _stream_.[[state]] is `"readable"`, let _stream_.[[waitPromise]] be a new promise rejected with _error_.
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
1. Let _stream_.[[waitPromise]] be a new promise.
1. Let _stream_.[[closedPromise]] be a new promise.
1. Let _stream_.[[notifyReady]] be a new built-in function object as defined in Notify Ready Function with [[Stream]] internal slot set to _stream_.
1. Let _stream_.[[error]] be a new built-in function object as defined in Error Function with [[Stream]] internal slot set to _stream_.
1. Let _startResult_ be the result of calling the [[Call]] internal method of _start_ with **undefined** as _thisArgument_ and (_stream_.[[notifyReady]], _stream_.[[error]]) as _argumentList_.
1. ReturnIfAbrupt(_startResult_).

##### ReadableByteStream.prototype.read ()

1. If **this**.[[readBufferSize]] is **undefined**, throw a **TypeError** exception.
1. Let _arrayBuffer_ be a new ArrayBuffer with length equals to **this**.[[readBufferSize]].
1. Let _bytesRead_ be ReadIntoArrayBuffer(**this**, _arrayBuffer_, 0, **this**.[[readBufferSize]]).
1. Let _arrayBufferView_ be a new Uint8Array constructed with _arrayBuffer_, 0 and _bytesRead_ as arguments.
1. Return _arrayBufferView_.

##### ReadableByteStream.prototype.readInto ( arrayBuffer, offset, size )

1. Return ReadIntoArrayBuffer(**this**, _arrayBuffer_, _offset_, _size_).

##### ReadableByteStream.prototype.cancel ( reason )

1. If `this.[[state]]` is `"closed"`, return a new promise resolved with **undefined**.
1. If `this.[[state]]` is `"errored"`, return a new promise rejected with `this.[[storedError]]`.
1. If `this.[[state]]` is `"waiting"`, resolve `this.[[waitPromise]]` with **undefined**.
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

##### get ReadableByteStream.prototype.wait

1. Let _stream_ be the **this** value.
1. Return _stream_.[[waitPromise]].

##### get ReadableByteStream.prototype.closed

1. Let _stream_ be the **this** value.
1. Return _stream_.[[closedPromise]].
