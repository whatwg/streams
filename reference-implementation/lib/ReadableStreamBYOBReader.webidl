[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamBYOBReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read(ArrayBufferView view, optional ReadableStreamBYOBReaderReadOptions options = {});
  Promise<ReadableStreamReadResult> fill(ArrayBufferView view);
  undefined releaseLock();
};
ReadableStreamBYOBReader includes ReadableStreamGenericReader;

dictionary ReadableStreamBYOBReaderReadOptions {
  [EnforceRange] unsigned long long atLeast;
};
