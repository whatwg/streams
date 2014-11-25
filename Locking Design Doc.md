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
    var string = "";
    var reader = rs.getReader();

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

### Level 2: subclassers of `ReadableStream`

Subclasses of `ReadableStream` should get locking support "for free." The same mechanisms for acquiring and using a lock should work flawlessly. More interestingly, if they wanted to support modifying the behavior of e.g. `read()` (or `state` or `ready` or `closed`), they should only have to override it in one location.

Which location is more friendly? Probably in `ReadableStream`, so that `ExclusiveStreamReader` still works for `ReadableStream` subclasses. Less work.

This means `ExclusiveStreamReader` should delegate to `ReadableStream`, and not the other way around.

### Level 3: custom readable stream implementations?

It is unclear whether this is necessary, but up until now we have a high level of support for anyone who wants to re-implement the entire `ReadableStream` interface with their own specific code. For example, if you implement `state`, `ready`, `closed`, `read()`, and `cancel()`, you can do `myCustomStream.pipeTo = ReadableStream.prototype.pipeTo` and it will continue to work.

If we encourage this kind of thing, we should make it easy for custom readable streams to be lockable as well. That basically means `ExclusiveStreamReader` should not require knowledge of `ReadableStream`'s internal slots.

We can work around this if necessary by passing `ExclusiveStreamReader` any capabilities it needs to manipulate `ReadableStream`'s internal state; then people reimplementing the readable stream interface can do e.g. `new ExclusiveStreamReader(this, { getLock, setLock })` or similar.

## Optimizability

The need to support subclassing, via `ExclusiveStreamReader` delegating to the `ReadableStream` implementation, conflicts a bit with the desire for readers to be fast. However, this can be fixed with some cleverness.

The spec semantics for e.g. `reader.read()` are essentially:

- Check that `reader@[[stream]]` is locked to `reader`.
- Unlock `reader@[[stream]]`.
- Try `return reader@[[stream]].read()`; finally re-lock `reader@[[stream]]`.

This will ensure that if `reader@[[stream]]` is a subclass of `ReadableStream`, it will polymorphically dispatch to the subclass's `read` method. However, this kind of try/finally pattern is not very optimizable in V8.

Here is an optimization that can be performed instead, with slight tweaks to both `ReadableStream.prototype.read` and `ExclusiveStreamReader.prototype.read`:

- Define `ReadableStream.prototype.read` as:
    - Check that `this` is not locked.
    - Return `ReadFromReadableStream(this)`. (That is, extract the main functionality, without the check, into its own function.)
- Define `ExclusiveStreamReader.prototype.read` like so:
    - Check that `this@[[stream]]` is locked to `this`.
    - If `this@[[stream]].read` is equal to the original `ReadableStream.prototype.read`: return `ReadFromReadableStream(this@[[stream]])`.
    - Otherwise, proceed via the per-spec semantics above.

This essentially ensures that all undisturbed readable streams, or readable stream subclasses that do not override `read`, go down the "fast path" by ignoring all the try/finally and lock/unlock business. It is unobservable, since we have checked that `read` has not been modified in any way.
