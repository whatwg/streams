# Streams API FAQ

This is a work in progress, documenting some design decisions that were made and that were non-obvious enough that we feel the need to explain them. We'll probably be adding to it as we go. If there's something you feel belongs here, please file an issue or pull request and we'll add it!

## Why don't errors that occur while cancelling put the readable stream in an error state?

The idea of cancelling a readable stream is that it should behave as a "loss of interest": the consumer cancelling the stream expects nobody will read from it further, and that the stream should be treated in the same way as if it had closed naturally. Thus, cancellation _immediately_ moves the stream into a `"closed"` state, which has the same properties as if the stream had closed itself. This gives the most consistent view of the stream to the outside world.

On the other hand, it may be important for the consumer _performing_ the cancellation to be notified whether the cancellation succeeds or fails. To handle this, you can simply use the promise returned from `.cancel()`:

```js
readableStream.cancel().then(
    () => console.log("Cancellation successful!"),
    err => console.error("Cancellation failed!", err)
);
```

## What's with `pipeTo` vs `pipeThrough`?

There are only two types of streams: readable and writable streams. `pipeTo` is for piping between them.

For the concept of something with a writable end and a readable end, we have "duplex streams." Duplex streams are really just containers for a pair of streams, one writable and one readable, stored in the properties `input` and `output` respectively.

Some duplex streams will be transform streams, wherein the input writable stream and the output readable stream are entangled, so that writing to the input affects what can be read from the output. This could be a very direct entanglement, of the sort produced by the `TransformStream` class, or something more indirect, such as the relationship between `stdin` and `stdout`.

`pipeThrough` is for piping into the writable half of the entangled streams and out the readable side. That is,

```js
src.pipeThrough(through).pipeTo(dest);
```

is really just sugar for:

```js
src.pipeTo(through.input);
through.output.pipeTo(dest);
```
