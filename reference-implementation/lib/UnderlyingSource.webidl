dictionary UnderlyingSource {
  ReadableStreamStartCallback start;
  ReadableStreamPullCallback pull;
  ReadableStreamCancelCallback cancel;
  ReadableStreamType type;
  [EnforceRange] unsigned long long autoAllocateChunkSize;
};

typedef (ReadableStreamDefaultController or ReadableByteStreamController) ReadableStreamController;

callback ReadableStreamStartCallback = any (ReadableStreamController controller);
callback ReadableStreamPullCallback = Promise<void> (ReadableStreamController controller);
callback ReadableStreamCancelCallback = Promise<void> (optional any reason);

 enum ReadableStreamType { "bytes" };
