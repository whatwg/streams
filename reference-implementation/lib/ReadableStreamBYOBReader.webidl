[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamBYOBReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read(ArrayBufferView view, optional ReadableStreamBYOBReaderReadOptions options = {});
  undefined releaseLock();
};
ReadableStreamBYOBReader includes ReadableStreamGenericReader;

dictionary ReadableStreamBYOBReaderReadOptions {
  [EnforceRange] unsigned long long min = 1;
};
