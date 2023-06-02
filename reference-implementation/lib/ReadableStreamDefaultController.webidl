dictionary StructuredSerializeOptions {
  sequence<object> transfer = [];
};

[Exposed=(Window,Worker,Worklet)]
interface ReadableStreamDefaultController {
  readonly attribute unrestricted double? desiredSize;

  undefined close();
  undefined enqueue(optional any chunk, optional StructuredSerializeOptions options = { });
  undefined error(optional any e);
};
