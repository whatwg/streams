[Exposed=(Window,Worker,Worklet)]
interface WritableStreamDefaultController {
  readonly attribute AbortSignal signal;
  void error(optional any e);
};
