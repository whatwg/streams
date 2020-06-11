dictionary Transformer {
  TransformerStartCallback start;
  TransformerTransformCallback transform;
  TransformerFlushCallback flush;
  any readableType;
  any writableType;
};

callback TransformerStartCallback = any (TransformStreamDefaultController controller);
callback TransformerFlushCallback = Promise<void> (TransformStreamDefaultController controller);
callback TransformerTransformCallback = Promise<void> (TransformStreamDefaultController controller, optional any chunk);
