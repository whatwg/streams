'use strict';

const { newPromise, resolvePromise } = require('./helpers/webidl.js');
const { ExtractHighWaterMark, ExtractSizeAlgorithm } = require('./abstract-ops/queuing-strategy.js');
const aos = require('./abstract-ops/transform-streams.js');

const Transformer = require('../generated/Transformer.js');

exports.implementation = class TransformStreamImpl {
  constructor(globalObject, [transformer, writableStrategy, readableStrategy]) {
    if (transformer === undefined) {
      transformer = null;
    }
    const transformerDict = Transformer.convert(transformer);
    if ('readableType' in transformerDict && transformerDict['readableType'] !== 'owning') {
      throw new TypeError('Invalid readableType specified');
    }
    if ('writableType' in transformerDict) {
      assert(transformerDict['writableType'] !== 'owning');
    }

    const readableHighWaterMark = ExtractHighWaterMark(readableStrategy, 0);
    const readableSizeAlgorithm = ExtractSizeAlgorithm(readableStrategy);
    const writableHighWaterMark = ExtractHighWaterMark(writableStrategy, 1);
    const writableSizeAlgorithm = ExtractSizeAlgorithm(writableStrategy);

    const startPromise = newPromise();

    aos.InitializeTransformStream(
      this, startPromise, writableHighWaterMark, writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm,
      transformerDict
    );
    aos.SetUpTransformStreamDefaultControllerFromTransformer(this, transformer, transformerDict);

    if ('start' in transformerDict) {
      resolvePromise(startPromise, transformerDict.start.call(transformer, this._controller));
    } else {
      resolvePromise(startPromise, undefined);
    }
  }

  get readable() {
    return this._readable;
  }

  get writable() {
    return this._writable;
  }
};
