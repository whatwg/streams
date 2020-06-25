[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamBYOBReader {
  constructor(ReadableStream stream);

  readonly attribute Promise<void> closed;

  Promise<void> cancel(optional any reason);
  Promise<ReadableStreamBYOBReadResult> read(ArrayBufferView view);
  void releaseLock();
};
