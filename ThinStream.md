```es6
class UnderlyingSink {
  // delegate contains:
  // - Back pressure signaling
  //   - markWaiting(): Tells the stream that backpressure is applied.
  //   - markWritable(): Tells the stream that backpressure is not applied.
  //   - onSpaceChange(): Tells the stream that get space() may return something new.
  // - Error signaling
  //   - markErrored(error): Tells the stream that the sink is errored.
  start(delegate)

  // Takes value and do some processing. May return something. If backpressure state is changed,
  // should call appropriate delegate function to update the stream.
  write(value)
  // Do something to finalize the sink. No more write() or close() comes. May return something.
  close()
  // Takes reason and do something to abort the sink. May return something.
  abort(reason)

  // Should returns a number indicating how much data can be written without causing backpressure.
  // Maye return undefined if it's unknown.
  get space()
}

class ThinWritableStream {
  // At the end of construction, calls start() on underlyingSink with delegate functions for this
  // stream.
  constructor(underlyingSink)

  // List of states in the form of:
  //   X -> A, B, C, ...
  // X is state name or a name of a group of states.
  // A, B, C, ... are the states X may transit to.
  //
  // - (write()/close() are allowed) -> "closed", "aborted", "errored"
  //   - "waiting" (backpressure not applied) -> "writable"
  //   - "writable" (backpressure applied) -> "waiting"
  // - "closed" -> "aborted", "errored"
  // - "aborted"
  // - "errored"
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
  get ready()
  // Returns the space available for write.
  //
  // Available in "waiting" and "writable" state.
  get space()
  // Returns a promise which gets fulfilled when space() becomes different value than one at the last
  // waitSpaceChange() call.
  //
  // Available in "waiting" and "writable" state.
  waitSpaceChange()
}

class UnderlyingSource {
  // delegate contains:
  // - Readability signaling
  //   - markWaiting(): Tells the stream that nothing is ready for synchronous reading.
  //   - markReadable(): Tells the stream that something is ready for synchronous reading.
  //   - markClosed(): Tells the stream that no more data will become available for read.
  // - Error signaling
  //   - markErrored(error): Tells the stream that the source is errored.
  start(delegate)

  // Returns something generated. If data availability is changed, should call appropriate
  // delegate function to update the stream.
  read()
  // Do something to cancel the source. May return something.
  cancel(reason)

  // Should interpret the given number v to update how much data to generate / pull and buffer
  // in the source.
  get onWindowUpdate(v)
}

class ThinReadableStream {
  constructor(underlyingSource)

  // - normal -> "cancelled", "errored", "closed"
  //   - "waiting" -> "readable"
  //   - "readable" -> "waiting"
  // - "closed"
  // - "cancelled"
  // - "errored"
  get state()

  // Returns a promise which gets fulfilled when this instance enters "readable" or "closed" state.
  get ready()
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
}
```
