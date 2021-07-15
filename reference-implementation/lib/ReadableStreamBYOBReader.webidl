[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamBYOBReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read(ArrayBufferView view);
  Promise<ReadableStreamReadResult> readFully(ArrayBufferView view);
  undefined releaseLock();
};
ReadableStreamBYOBReader includes ReadableStreamGenericReader;
