[Exposed=(Window,Worker,Worklet)]
interface ByteLengthQueuingStrategy {
  constructor(QueuingStrategyInit init);

  attribute unrestricted double highWaterMark;
  readonly attribute Function size;
};
