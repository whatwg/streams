# Streams API

## Abstract

The streams API provides an interface for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and buffering. They provide an [extensible web](http://extensiblewebmanifesto.org/) toolbox upon which higher-level abstractions can be built, such as filesystem or socket APIs, while at the same time users can use the supplied tools to build their own streaming abstractions.

Both low-level generic streams, with customizable buffering strategy, and high-level binary and string streams, with high water marks providing a built-in buffering strategy, are described. The latter is of course built on top of the former.

## Status

This document is undergoing heavy revision. Please peruse and comment on the repository's issues.

## Goals

### Required Background Reading

The most clear and insightful commentary on a streams API has so far been produced by Isaac Schlueter, lead Node.js maintainer. In a series of posts on the public-webapps list, he outlined his thoughts, first [on the general concepts and requirements of a streams API](http://lists.w3.org/Archives/Public/public-webapps/2013JulSep/0275.html), and second [on potential specific API details and considerations](http://lists.w3.org/Archives/Public/public-webapps/2013JulSep/0355.html). This document leans heavily on his conceptual analysis.

To understand the importance of backpressure, watch [Thorsten Lorenz's LXJS 2013 talk](https://www.youtube.com/watch?v=9llfAByho98) and perhaps play with his [stream-viz](http://thlorenz.github.io/stream-viz/) demo.

### Requirements

Drawing upon the JavaScript community's extensive experience with streaming primitives, we list these scenarios that must be solved within the scope of a complete stream abstraction.

#### Creating Streams

**You must be able to create streams that efficiently adapt existing _push_-based data sources into a uniform streaming interface.**

A _push-based_ data source is one which, while the flow is turned on, pushes data at you (e.g. via events). It may also provide a mechanism for pausing and resuming the flow of data. However, this mechanism could be advisory, i.e. you may still receive data after requesting a pause. It is important not to lose such data (it must be buffered).

An example of a push-based data source is a TCP socket. (TODO: someone who knows TCP better explain exactly the way in which it pushes data, and what "pausing" means in that context and why it is advisory.)

In general, a push-based data source can be modeled as:

- A `readStart` method that starts the flow of data
- A `readStop` method that sends an advisory signal to stop the flow of data
- A `ondata` handler that fires when new data is pushed from the source
- A `onend` handler that fires when the source has no more data
- A `onerror` handler that fires when the source signals an error getting data

**You must be able to create streams that efficiently adapt existing _pull_-based data sources into a uniform streaming interface.**

A _pull-based_ data source is one which you must request data from. The data may be available synchronously, or asynchronously. It is important not to let this [zalgo-esque](http://blog.izs.me/post/59142742143/designing-apis-for-asynchrony) implementation detail leak into the semantics of the uniform stream API, but at the same time, it is preferable not to impose a delay on consumers if the data is available synchronously.

An example of a pull-based data source is a file descriptor. (TODO: someone explain how this maps to C-level APIs.)

In general, a pull-based data source can be modeled as:

- An `open` function that returns a descriptor for the source
- A `read(cb)` function that can call `cb` either synchronously or asynchronously, with either `(err, null)` or `(null, data)`

#### Consuming Streams

**You must not lose data.**

A common problem with push-based data sources is that they make it very easy to lose data if you do not immediately process it.

For example, Node.js's "streams1" (version 0.6 and below) presented a push-based API that mapped directly to the underlying data source. So a stream for incoming HTTP POST request data would fire `"data"` events continually. A common problem was the desire to perform some asynchronous action, such as authentication, before consuming the stream. But while this asynchronous authentication was taking place, data events would be fired and lost. Worse, calling `pause()` on the request stream did not work, because the pause mapped directly to the underlying TCP primitive, which is only advisory. This forced authors to manually buffer incoming requests, which was easy to do incorrectly or inefficiently.

The solution is to move the buffering logic into the stream primitive itself, removing the error-prone and easy-to-forget process it forces upon consumers. If you stop there, you end up with a push stream with  `pause()` and `resume()` methods that are not advisory, but instead reliably stop the flow of `"data"`, `"end"`, and `"close"` events. However, you can take this further, and use your internal buffer to unify both push- and pull-based data sources into a single pull-based streaming API.

#### Composing Streams

**You must be able to pipe streams to each other.**

The primary way of consuming streams is to pipe them to each other. This is the essence of streaming APIs: getting data from a readable stream to a writable one, while buffering as little data as possible in memory.

```js
fs.createReadStream("source.txt")
    .pipe(fs.createWriteStream("dest.txt"));

http.get("http://example.com")
    .pipe(fs.createWriteStream("dest.txt"));
```

**You must be able to transform streams via the pipe chain**

A naturally-arising concept is a *transform stream*, i.e. a stream that is both readable and writable, such that when data is written to it, transformed data is written out the other side. Note that the transform is rarely one-to-one; for example a compression algorithm can be represented as a transform stream that reads much more than it writes.

```js
fs.createReadStream("source.zip")
    .pipe(zlib.createGzipDecompressor(options))
    .pipe(fs.createWriteStream("dest/"));

fs.createReadStream("index.html")
    .pipe(zlib.createGzipCompressor(options))
    .pipe(httpServerResponse);

http.get("http://example.com/video.mp4")
    .pipe(videoProcessingWebWorker)
    .pipe(document.query("video"));

fs.createReadStream("source.txt")
    .pipe(new StringDecoder("utf-8"))
    .pipe(database1.queryExecutor)
    .pipe(database2.tableWriter("table"));
```

_NOTE: a transform stream is not always the most efficient or straightforward abstraction, although it may fit nicely into a pipe chain. For example, the `StringDecoder` transform above is a synchronous transformation, and the transform stream machinery is possibly overkill. A simpler approach might be a simple function that takes a readable stream of `ArrayBuffer`s and returns a readable stream of strings, by wrapping the appropriate methods to synchronous transformation._

**You must be able to communicate backpressure.**

_Backpressure_ is roughly the act of letting the slowest writable stream in the chain govern the rate at which data is consumed from the ultimate data source. This is necessary to make sure a program has a reasonable upper bound on memory usage as it buffers to prevent losing data. Without backpressure, slow writable streams in the chain will either cause memory usage to balloon as buffered data grows without limit, or will cause data loss if the buffers are capped at a hard limit.

If this data source is pull-based, this means not pulling data any faster than required; if the data source is push-baed, this means issuing a pause signal when too much data has already been pushed but not yet flushed through the stream chain.

The exact strategy for applying backpressure can be a quite subtle matter, and will depend on whether you want your stream API to present a pull- or push-based interface. Assuming a pull-based stream interface, the most naïve backpressure strategy is:

- When adapting pull sources, pull data when requested, but never proactively.
- When adapting push sources, send a start signal when data is requested, and once the data arrives, send a stop signal.

These strategies are enough for a generic case, but performance wins can be had by allowing some in-memory buffering, limited by a specified *high water mark*. This more advanced strategy consists of:

- When adapting pull sources, proactively pull data into an internal buffer until it accumulates to the high water mark, so that it is available immediately when requested. Once the buffer is drained, resume proactively pulling in data.
- When adapting push sources, send a start signal immediately, and accumulate data as it arrives until it reaches the high water mark. When it does so, send the stop signal. Once the buffer is drained, send the start signal again.

You can introduce an even more advanced strategy by adding a *low water mark*, which modifies the above by resuming data collection once the buffer reaches the low water mark instead of once the buffer is entirely drained.

**You must be able to pipe a stream to more than one writable stream.**

Many use cases requiring piping a stream to more than one destination, e.g. a HTTP response both to a user and to a disk cache, or a stream of video data both to the local user and across an HTTP connection.

The simplest way to implement this is by introduce a "tee" duplex stream, such that writing to it writes to two separate destination streams. Then, piping to two writable streams is done by piping to a tee stream wrapping those two. However, requiring users to remember this can be a footgun, and it may be advisable to automatically create a tee stream for them.

The tee stream can use a number of strategies to govern how the speed of its outputs affect the backpressure signals it gives off, but the simplest strategy is to pass aggregate backpressure signals directly up the chain, thus letting the speed of the slowest output determine the speed of the tee.

#### Other

**You must be able to create streams that represent "duplex" data sources.**

A common I/O abstraction is a data source that is both readable and writable, but the input and output are not related. For example, communication along a TCP socket connection can be bidirectional, but in general the data you read form the socket is not governed by the data you write to it.

The most natural way to enable this concept is to allow readable and writable stream interfaces to both be implemented, by ensuring they do not overlap (e.g. don't both have a `"state"` property).


## A Stream Toolbox

In extensible web fashion, we will build up to a fully-featured streams from a few basic primitives:

- `BaseReadableStream`
    - Has a very simple backpressure strategy, communicating to the underlying data source that it should stop supplying data immediately after it pushes some onto the stream's underlying buffer. (In other words, it has a "high water mark" of zero.)
    - Support piping to only one destination.
- `SplitterStream`
    - A writable stream, created from two writable streams, such that writing to it writes to the two destination streams.
- `BufferingStrategyReadableStream`
    - Derives from `BaseReadableStream`
    - Adds the ability to customize the buffering and backpressure strategy, overriding the basic one.
    - ISSUE: could I make this a transform stream? Seems like it should be, but not sure how exactly.
- `ReadableStream`
    - Derives from `BufferingStrategyReadableStream`.
    - Supports piping to more than one destination, by using the `SplitterStream` transform stream within its `pipe` method.
- `lengthBufferingStrategy`
    - A buffering strategy that uses the `length` property of incoming objects to compute how they contribute to reaching the designated high water mark.
    - Useful mostly for streams of `ArrayBuffer`s and strings.
- `countBufferingStrategy`
    - A buffering strategy that assumes each incoming object contributes the same amount to reaching the designated high water mark.
    - Useful for streams of objects.
