[Exposed=(Window,Worker,Worklet)]
interface TransformStreamDefaultController {
  readonly attribute unrestricted double? desiredSize;

  undefined enqueue(optional any chunk);
  undefined error(optional any reason);
  undefined terminate();
};
