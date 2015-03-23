## Readable Byte Stream

### Class ReadableByteStream

#### Class Definition

```
class ReadableByteStream {
    constructor(underlyingByteSource = {})

    cancel(reason)
    getReader()
    getByobReader()
    pipeThrough({ writable, readable }, options)
    pipeTo(dest, { preventClose, preventAbort, preventCancel } = {}) 
}
```

#### Properties of the ReadableByteStream Prototype

##### getReader()

The `getReader` method creates a readable stream reader and locks the byte stream to the new reader.

The reader's `read()` method returns a Uint8Array.

##### getByobReader()

The `getByobReader` method creates a byob byte stream reader and locks the byte stream to the new reader.

### Class ByobByteStreamReader

#### Class Definition

```
class ByobByteStreamReader {
    constructor(byteStream)

    get closed()

    cancel(reason)
    read(view)
    releaseLock()
}
```

#### Properties of the ByobByteStreamReader Prototype

##### read(view)

1. If **this**.[[queue]] is not empty, fill _view_ with the contents of elements in **this**.[[queue]].
1. Let _bytesFilled_ be the number of the bytes copied to _view_.
1. Let _newView_ be a new `ArrayBufferView` of the same type whose `buffer` is _view_.buffer, `byteLength` is _view_.byteLength, and `byteOffset` is _view_.byteOffset - _bytesFilled_.
1. InvokeOrNoop(**this**@[[underlyingByteSource]], `"read"`, «_done_, _newView_»)
