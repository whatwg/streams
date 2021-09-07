dictionary QueuingStrategy {
  unrestricted double highWaterMark;
  QueuingStrategySize size;
};

callback QueuingStrategySize = unrestricted double (any chunk);
