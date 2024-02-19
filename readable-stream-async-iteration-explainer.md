# `ReadableStream` Async Iteration Explained


## Introduction

The streams APIs provide ubiquitous, interoperable primitives for creating, composing, and consuming streams of data.

This change adds support for the [async iterable protocol](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols)
to the `ReadableStream` API, enabling readable streams to be used as the source of `for await...of` loops.

To consume a `ReadableStream`, developers currently acquire a reader and repeatedly call `read()`:
```javascript
async function getResponseSize(url) {
  const response = await fetch(url);
  const reader = response.body.getReader();
  let total = 0;

  while (true) {
    const {done, value} = await reader.read();
    if (done) return total;
    total += value.length;
  }
}
```

By adding support for the async iterable protocol, web developers will be able to use the much simpler
`for await...of` syntax to loop over all chunks of a `ReadableStream`.

## API

The [ReadableStream definition](https://streams.spec.whatwg.org/#rs-class-definition) is extended
with a [Web IDL `async iterable` declaration](https://webidl.spec.whatwg.org/#idl-async-iterable):
```
interface ReadableStream {
  async iterable<any>(optional ReadableStreamIteratorOptions options = {});
};

dictionary ReadableStreamIteratorOptions {
  boolean preventCancel = false;
};
```

This results in the following methods being added to the JavaScript binding:

*   `ReadableStream.prototype.values({ preventCancel = false } = {})`: returns an [AsyncIterator](https://tc39.es/ecma262/#sec-asynciterator-interface)
    object which locks the stream.
    *  `iterator.next()` reads the next chunk from the stream, like `reader.read()`.
        If the stream becomes closed or errored, this automatically releases the lock.
    *  `iterator.return(arg)` releases the lock, like `reader.releaseLock()`.
        If `preventCancel` is unset or false, then this also cancels the stream
        with the optional `arg` as cancel reason.
*   `ReadableStream.prototype[Symbol.asyncIterator]()`: same as `values()`.
     This method makes `ReadableStream` adhere to the [ECMAScript AsyncIterable protocol](https://tc39.es/ecma262/#sec-asynciterable-interface),
     and enables `for await...of` to work.

## Examples

The original example can be written more succinctly using `for await...of`:
```javascript
async function getResponseSize(url) {
  const response = await fetch(url);
  let total = 0;
  for await (const chunk of response) {
    total += chunk.length;
  }
  return total;
}
```

Finding a specific chunk or byte in a stream also becomes easier (adapted from
[Jake Archibald's blog post](https://jakearchibald.com/2017/async-iterators-and-generators/#making-streams-iterate)):
```javascript
async function example() {
  const find = 'J';
  const findCode = find.codePointAt(0);
  const response = await fetch('https://html.spec.whatwg.org');
  let bytes = 0;

  for await (const chunk of response.body) {
    const index = chunk.indexOf(findCode);

    if (index != -1) {
      bytes += index;
      console.log(`Found ${find} at byte ${bytes}.`);
      break;
    }

    bytes += chunk.length;
  }
}
```
Note that the stream is automatically cancelled when we `break` out of the loop.
To prevent this, for example if you want to consume the remainder of the stream differently,
you can instead use `response.body.values({ preventCancel: true })`.


## Goals

*   Permit `ReadableStream` to be used as the source of a `for await...of` loop.


## Non-goals

N/A.


## End-user benefit

*   Reduces boilerplate for developers when manually consuming a `ReadableStream`.
*   Allows integration with future ECMAScript proposals, such as [Async Iterator Helpers](https://github.com/tc39/proposal-async-iterator-helpers).
*   Allows interoperability with other APIs that can "adapt" async iterables, such as
    Node.js [Readable.from](https://nodejs.org/docs/latest-v20.x/api/stream.html#streamreadablefromiterable-options).


## Alternatives

*   It was [initially suggested](https://github.com/whatwg/streams/issues/778#issuecomment-371711899)
    that we could use a `ReadableStreamDefaultReader` as an `AsyncIterator`, by adding `next()`
    and `return()` methods directly to the reader. However, the return values of `return()` and
    `releaseLock()` are different, so the choice went to adding a separate async iterator object.
