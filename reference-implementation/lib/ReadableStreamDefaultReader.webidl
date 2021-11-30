[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamDefaultReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamDefaultReadResult> read();
  undefined releaseLock();
};
ReadableStreamDefaultReader includes ReadableStreamGenericReader;
