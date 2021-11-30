[Exposed=(Window,Worker,Worklet), Transferable]
interface WritableStream {
  constructor(optional object underlyingSink, optional QueuingStrategy strategy = {});

  readonly attribute boolean locked;

  Promise<undefined> abort(optional any reason);
  Promise<undefined> close();
  WritableStreamDefaultWriter getWriter();
};
