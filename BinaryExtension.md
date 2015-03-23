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
