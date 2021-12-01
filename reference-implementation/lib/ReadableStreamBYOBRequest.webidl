[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamBYOBRequest {
  readonly attribute ArrayBufferView? view;

  undefined respond([EnforceRange] unsigned long long bytesWritten);
  undefined respondWithNewView(ArrayBufferView view);
};
