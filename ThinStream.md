```es6
class UnderlyingSink {
  // delegate contains:
  // - markWaiting(): Tells the stream that backpressure is applied.
  // - markWritable(): Tells the stream that backpressure is not applied.
  // - markErrored(error): Tells the stream that the sink is errored.
  // - onSpaceChange(): Tells the stream that get space() may return something new.
  init(delegate)

  // May return something. If backpressure state is changed, should call appropriate
  // delegate function to update the stream.
  write(value)
  // May return something.
  close()
  // May return something.
  abort()

  get space()
}

// Once a writer is created, promises obtained from this stream are not fulfilled until the
// writer is released.
class WritableStream {
  // At the end of construction, calls init() on underlyingSink with delegate functions for this
  // stream.
  constructor(underlyingSink)

  // List of states in the form of:
  //   X -> A, B, C, ...
  // X is state name or a name of a group of states.
  // A, B, C, ... are the states X may transit to.
  //
  // - "locked" -> available
  // - available -> "locked"
  //   - (write()/close() are allowed) -> "closed", "aborted", "errored"
  //     - "waiting" (backpressure not applied) -> "writable"
  //     - "writable" (backpressure applied) -> "waiting"
  //   - "closed" -> "aborted", "errored"
  //   - "aborted"
  //   - "errored"
  //
  // Distinction between "waiting" and "writable" is a part of the flow control interfaces.
  get state()

  // Main interfaces.

  // Passes value and returns something returned by the underlying sink.
  //
  // Available in "waiting" and "writable" state.
  write(value)
  // Tells the underlying sink that no more data will be write()-en and returns something returned
  // by the underlying sink.
  //
  // Available in "waiting" and "writable" state.
  close()
  // Tells the underlying sink that no more data will be write()-en and returns something returned
  // by the underlying sink.
  //
  // Available in "waiting", "writable" and "closed" state.
  abort(reason)

  // Error receiving interfaces.

  // Returns a promise which gets fulfilled when this instance enters the "errored" state.
  get errored()
  // Returns an object representing the error when the state is "errored".
  get error()

  // Flow control interfaces.

  // Returns a promise which gets fulfilled when this instance enters "writable" state.
  get writable()
  // Returns the space available for write.
  //
  // Available in "waiting" and "writable" state.
  get space()
  // Returns a promise which gets fulfilled when space() becomes different value than one at the last
  // waitSpaceChange() call.
  //
  // Available in "waiting" and "writable" state.
  waitSpaceChange()

  // Locking interfaces.

  // Creates and returns an ExclusiveStreamWriter instance. Once a writer is created, all methods
  // and accessors on this stream throws until the writer is released.
  //
  // Available in all states if there is no existing active writer.
  getWriter()
}

// Once release() is called, all methods and accessors on this writer throw.
class ExclusiveStreamWriter {
  // - "locked" -> available
  // - available -> "locked"
  //   - (write()/close() are allowed) -> "closed", "aborted", "errored"
  //     - "waiting" (backpressure not applied) -> "writable"
  //     - "writable" (backpressure applied) -> "waiting"
  //   - "closed -> "aborted", "errored"
  //   - "aborted"
  //   - "errored"
  get state()

  get writable()
  get space()
  waitSpaceChange()

  get errored()
  get error()

  write(argument)
  close()
  abort(reason)

  release()
}

class UnderlyingSource {
  // delegate contains:
  // - markWaiting(): Tells the stream that nothing is ready for synchronous reading.
  // - markReadable(): Tells the stream that something is ready for synchronous reading.
  // - markDrained(): Tells the stream that no more data will become available for read.
  // - markErrored(error): Tells the stream that the source is errored.
  init(delegate)

  // Returns something. If data availability is changed, should call appropriate
  // delegate function to update the stream.
  read()
  // May return something.
  cancel(reason)

  get onWindowUpdate(v)
}

class ReadableStream {
  constructor(underlyingSource)

  // - "locked" -> available
  // - available -> "locked"
  //   - normal -> "cancelled", "errored"
  //     - "waiting" -> "readable"
  //     - "readable" -> "waiting", "drained"
  //   - "drained"
  //   - "cancelled"
  //   - "errored"
  get state()

  // Returns a promise which gets fulfilled when this instance enters "readable" state.
  get readable()
  // Returns something returned by the underlying source.
  //
  // Available in "readable" state.
  read()
  // Passes reason and returns something returned by the underlying source.
  //
  // Available in "waiting" and "readable" state.
  cancel(reason)

  get errored()
  get error()

  // Flow control interfaces.

  // Available in "waiting" and "readable" state.
  get window()
  // Passes v to the underlying source. v indicates how much data should be pulled.
  //
  // Available in "waiting" and "readable" state.
  set window(v)

  // Locking interfaces.

  getReader()
}
```
