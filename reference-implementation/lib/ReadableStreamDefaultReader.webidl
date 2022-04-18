[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamDefaultReader {
  constructor(ReadableStream stream);

  Promise<ReadableStreamReadResult> read();
  undefined releaseLock();
};
ReadableStreamDefaultReader includes ReadableStreamGenericReader;
