[Exposed=(Window,Worker,Worklet)]
interface CountQueuingStrategy {
  constructor(QueuingStrategyInit init);

  attribute unrestricted double highWaterMark;
  readonly attribute Function size;
};
