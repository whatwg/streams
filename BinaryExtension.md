# Streams API Binary Extension

## Readable Byte Stream API

### ReadableByteStream

```
class ReadableByteStream {
    any readInto(arraybuffer, offset, size)

    [[onReadInto]]
}   
```

The underlying sink implements `[[onReadInto]]`

#### Properties of the ReadableByteStream Prototype Object

##### ReadableByteStream.prototype.readInto ( arraybuffer, offset, size )

1. Let _stream_ be the **this** value.
1. If _stream_.[[state]] is `"waiting"` or `"closed"`, throw a **TypeError** exception.
1. If _stream_.[[state]] is `"errored"`, throw _stream_.[[storedError]].
1. Assert: _stream_.[[state]] is `"readable"`.
1. If _offset_ is **undefined**, let _offset_ be 0.
1. Otherwise,
    1. Let _offset_ be ToInteger(_offset_).
    1. ReturnIfAbrupt(_offset_).
    1. If _offset_ < 0, throw a **TypeError** exception.
1. If _size_ is **undefined**, let _size_ be _arraybuffer_.[[byteLength]] - _offset_.
1. Otherwise,
    1. Let _size_ be ToInteger(_size_).
    1. ReturnIfAbrupt(_size_).
1. If _size_ < 0 or _offset_ + _size_ > _arraybuffer_.[[byteLength]], throw a **TypeError** exception.
1. Let _bytesRead_ be the result of calling the [[Call]] internal method of _stream_.[[onReadInto]] with **undefined** as _thisArgument_ and (_arraybuffer_, _offset_, _size_) as _argumentsList_
1. If _bytesRead_ is an abrupt completion,
    1. Call _stream_.\[\[error\]\](_bytesRead_.[[value]]).
    1. Throw _bytesRead_.[[value]].
1. Let _bytesRead_ be ToNumber(_bytesRead_).
1. If _bytesRead_ < -2 or _bytesRead_ > _arraybuffer_.[[byteLength]],
    1. Let _error_ be a **TypeError** exception.
    1. Call _stream_.\[\[error\]\](_error_).
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
