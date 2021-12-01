dictionary Transformer {
  TransformerStartCallback start;
  TransformerTransformCallback transform;
  TransformerFlushCallback flush;
  any readableType;
  any writableType;
};

callback TransformerStartCallback = any (TransformStreamDefaultController controller);
callback TransformerFlushCallback = Promise<undefined> (TransformStreamDefaultController controller);
callback TransformerTransformCallback = Promise<undefined> (any chunk, TransformStreamDefaultController controller);
