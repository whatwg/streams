dictionary StructuredSerializeOptions {
  sequence<object> transfer = [];
};

[Exposed=(Window,Worker,Worklet)]
interface TransformStreamDefaultController {
  readonly attribute unrestricted double? desiredSize;

  undefined enqueue(optional any chunk, optional StructuredSerializeOptions options = { });
  undefined error(optional any reason);
  undefined terminate();
};
