[Exposed=(Window,Worker,Worklet)]
interface WritableStreamDefaultController {
  readonly attribute AbortSignal signal;
  undefined error(optional any e);
  undefined releaseBackpressure();
};
