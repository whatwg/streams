[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamDefaultReader {
  constructor(ReadableStream stream);

  readonly attribute Promise<void> closed;

  Promise<void> cancel(optional any reason);
  Promise<ReadableStreamReadResult> read();
  void releaseLock();
};
