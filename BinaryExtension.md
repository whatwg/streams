# Readable Byte Stream

## Semantics

`ReadableByteStream` has a hidden state. The state can be one of the following:
- `"readable"`: Data may be readable
- `"closed"`: No more data is readable
- `"errored"`: The stream has been errored

The state is not exposed but is observable by calling the methods on the stream or reader.

## Class ReadableByteStream

### Class Definition

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

### Properties of the ReadableByteStream Prototype

#### getReader()

The `getReader` method creates a readable stream reader and locks the byte stream to the new reader.

The reader's `read()` method returns a Uint8Array.

#### getByobReader()

See [#294](https://github.com/whatwg/streams/issues/294) about method naming.

The `getByobReader` method creates a byob byte stream reader and locks the byte stream to the new reader.

## Class ByobByteStreamReader

### Class Definition

```
class ByobByteStreamReader {
    constructor(byteStream)

    get closed()

    cancel(reason)
    read(view)
    releaseLock()
}
```

### Properties of the ByobByteStreamReader Prototype

#### get closed()

Used for getting notified that the stream is closed or errored.

If the promise returned by this getter:
- fulfills, that means either of:
    - the stream has been closed
    - the reader has been released while the stream was readable
- rejects, that means either of:
    - the stream has been errored

#### cancel(reason)

##### Semantics

Tells the byte stream to stop generating or buffering data.

- _reason_: An object indicating the reason why the consumer lost interest

###### Return value

If the returned promise:
- fulfills, that means either of:
    - the stream has been already closed
    - the reader has been already released while the stream was readable
    - the stream was successfully cancelled for this `cancel()` call. In this case, the stream becomes `"closed"`.
- rejects, that means either of:
    - the stream has been already errored
    - the stream was cancelled for this `cancel()` call but the cancellation finished uncleanly. In this case, the stream becomes `"closed"`.

#### read(view)

##### Semantics

Used for reading bytes into `view` and also for getting notified that the stream is closed or errored.

- _view_: An `ArrayBufferView` to which the reader stores the bytes read from the stream

###### Return value

If the return promise:
- fulfills with _fulfillmentValue_,
    - if _fulfillmentValue_.done is set,
        - that means either of:
            - the stream has been closed
            - the reader has been already released while the stream was readable
        - _fulfillmentValue_.value is set to an `ArrayBufferView` of the same type as _view_ with `byteLength` set to 0 and `byteOffset` set to the same value as _view_
    - otherwise,
        - that means that bytes were successfully read. The bytes are stored in the region specified by _fulfillmentValue_.value which is an `ArrayBufferView` of the same type as _view_ with `byteOffset` set to the same value as _view_
- rejects, that means either of:
    - the stream has been errored

##### Sample algorithm

1. Let _p_ be a new pending promise.
1. Detach the ArrayBuffer object pointed by _view_ from _view_.
1. Let _view_ be a new reference pointing the ArrayBuffer.
1. If **this**.[[queue]] is not empty,
    1. Fill _view_ with the contents of elements in **this**.[[queue]].
    1. Pop the elements that have been fully consumed from **this**.[[queue]], and adjust partially consumed ones to represent the remaining region.
    1. Let _bytesFilled_ be the number of the bytes copied to _view_.
    1. Let _newView_ be a new `ArrayBufferView` of the same type whose `buffer` is _view_.buffer, `byteLength` is _view_.byteLength, and `byteOffset` is _view_.byteOffset - _bytesFilled_.
    1. Resolve _p_ with `{done: false, value: view}`.
1. Otherwise, InvokeOrNoop(**this**@[[underlyingByteSource]], `"read"`, «_done_, _view_»)
1. Return _p_.

#### releaseLock()

##### Semantics

Detaches the reader from the stream.

###### Return value and exception

The return value of this method is void (always **undefined** if successful).

If this method returns without throwing, that means either of:
- the reader was released successfully
- the reader has already been released

If this method throws,
- that means that some of `read(view)` calls haven't yet been completed
- the failure doesn't affect the state of the stream or reader
