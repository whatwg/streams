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

## What's with pipeTo vs pipeThrough?

There are only 2 types of streams, Readable and Writable streams, pipeTo is for piping between them.  For the concept of streams that are both readable and writable we have Duplex streams which are really just containers for a pair of entangled streams, one readable and one writable stored in the keys 'output' and 'input' respectively. pipeThrough is for piping into the writable half of the entangled streams and out the readable side:

```js
src.pipeThrough(through).pipeTo(dest);
```

is really just sugar for:

```js
src.pipeTo(through.input);
through.output.pipeTo(dest);
```