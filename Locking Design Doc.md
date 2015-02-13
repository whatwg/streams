# Locking a Stream for Exclusive Reading

In [#241](https://github.com/whatwg/streams/issues/241) we had a great conversation about the need for being able to "lock" a stream for exclusive use. This would be done implicitly while piping, but could also be useful for building user-facing abstractions, as we'll see below.

What emerged was the idea of a "stream reader," which has most of the readable stream interface, but while it exists you cannot read from the stream except through that reader.

This document represents some formative rationales for the design of the reader concept, approached from the perspective of a developer that uses increasingly complex features of the streams ecosystem.

## Developer usage

### Level 0: no reader usage

If the developer knows nothing about readers, they can continue using the stream just fine.

- `read()`, `state`, and `ready` all behave as they do now if used without `pipeTo`.
- `pipeTo` will cause the following side effects:
    - `read()` will throw an informative error
    - `state` will return `"waiting"` until the pipe completes (successfully or otherwise)
    - `ready` will return a promise that remains pending until the pipe completes

### Level 1: using readers directly

The developer might want to create their own abstractions that require exclusive access to the stream. For example, a read-to-end function would probably want to avoid others being able to call `.read()` in the middle.

Example code:

```js
function readAsJson(rs) {
    let string = "";
    const reader = rs.getReader();

    pump();

    // These lines would be simpler with `Promise.prototype.finally` (or async functions).
    return reader.closed.then(
        () => {
            reader.releaseLock();
            return JSON.parse(string);
        },
        e => {
            reader.releaseLock();
            throw e;
        }
    );

    function pump() {
        while (reader.state === "readable") {
            string += reader.read();
        }
        if (reader.state === "waiting") {
            reader.ready.then(pump);
        }
    }
}
```

The stream would have the same behaviors after being passed to `readAsJson` that it would have after calling its `pipeTo` method.

The reader should have all of the non-piping-related public interface of the stream. This includes:

- `closed` getter, which is a pass-through
- `state` and `ready` getters, which reveal the "true" state and state transitions of the stream which the stream itself no longer reveals
- `read()` method, which has the same behavior as that of the stream's except that it works while the stream is locked
- `cancel()` method, which first calls `this.releaseLock()` before the pass-through

While a stream is locked, it is indistinguishable from a stream that has been drained of all chunks and is not getting any more enqueued. We could consider adding some kind of test, like `stream.isLocked`, to distinguish. However, it's not clear there's a compelling reason for doing so (let us know if so?), and the indistinguishability is kind of a nice property from the perspective of the principle of least authority.

For readers, you should be able to tell if they're still active (i.e. have not been released) via `reader.isActive`.

Once a reader is released, it behaves like a closed stream (unless the encapsulated stream has already errored, in which case it behaves like the errored stream).

Note that with this setup, all the same invariants apply to readable streams as they do to readers. For example, when `ready` is fulfilled, the reader's `state` property will no longer return `"waiting"`, and `read()` will return a chunk, just like with a stream.

### Level 2: subclassers of `ReadableStream`

Subclasses of `ReadableStream` should get locking support "for free," within reason. The same mechanisms for acquiring and using a lock should work flawlessly.

However, if the subclasser starts overriding `read()`, `state`, or `ready`, they will be in trouble. These are delicate operations that reflect the state of the internal queue. The point of the `ExclusiveStreamReader` is to bypass the developer's ability to directly inspect the internal queue.

As such, we design `read()`, `state`, and `ready` for readers to bypass the public API of the readable stream and go directly to its internal queue. That means any subclass customizations to `read()` et al. will be bypassed when using `ExclusiveStreamReader`.

In most cases we can imagine, this will be exactly what you want. For example, let's say you were trying to do something like Node.js streams, which emit a `"data"` event whenever a chunk is read. One way of doing this (perhaps not the best way) would be to subclass `ReadableStream` and replace the `read` method with something like `this.emit("data", chunk); super.read(chunk);`. But this is exactly the kind of code an exclusive reader should bypass!

However, if you really need your exclusive reader to work with customized `read()`, `state`, or `ready`, there's an escape hatch! You can just implement your own reader class, and return it from your overridden `getReader()` method. It can coordinate with your overridden `read()`/`state`/`ready` all it wants.

### Level 3: custom readable stream implementations

A custom readable stream implementation is a class that intends to behave like a readable stream, but does not subclass `ReadableStream` per se. A good example is the experimental `ReadableByteStream` we have in this repo.

As explained above, readers are coupled fairly tightly to the internal queue of the stream. Since custom readable streams can have an arbitrary internal structure, custom readable streams will need to implement their own readers and `getReader()` method.

Note that if they implement a `getReader()` that returns something conforming to the exclusive stream reader API, along with `state`, `ready`, `closed`, `read()`, and `cancel()`, then `ReadableStream.prototype.pipeTo` (and `pipeThrough`) will still work when applied generically to the custom readable stream.
