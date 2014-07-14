import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import TransformStream from '../lib/transform-stream';
import ByteLengthQueuingStrategy from '../lib/byte-length-queuing-strategy';

export default params => {
  var chunksSoFar = 0;
  var paused = false;
  var pauses = 0;

  var generateData;
  var rs = new ReadableStream({
    start(enqueue, close) {
      generateData = () => {
        if (paused) {
          return;
        }

        if (chunksSoFar++ >= params.underlyingSourceChunks) {
          close();
          return;
        }

        var chunk = new ArrayBuffer(params.underlyingSourceChunkSize);
        if (!enqueue(chunk)) {
          paused = true;
          ++pauses;
        }

        potentiallySyncSetTimeout(generateData, params.underlyingSourceRate);
      };

      potentiallySyncSetTimeout(generateData, params.underlyingSourceRate);
    },

    pull(enqueue, close) {
      paused = false;
      potentiallySyncSetTimeout(generateData, params.underlyingSourceRate);
    },

    strategy: new ByteLengthQueuingStrategy({ highWaterMark: params.readableStreamHWM })
  });

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      var newChunk = new ArrayBuffer(params.underlyingSourceChunkSize * params.transformSizeMultiplier);
      potentiallySyncSetTimeout(() => enqueue(newChunk), params.transformRate / 2);
      potentiallySyncSetTimeout(done, params.transformRate);
    },
    inputStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformInputHWM }),
    outputStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformOutputHWM })
  });

  var ws = new WritableStream({
    write(chunk, done) {
      potentiallySyncSetTimeout(done, params.underlyingSinkRate);
    },

    strategy: new ByteLengthQueuingStrategy({ highWaterMark: params.writableStreamHWM })
  });

  return rs.pipeThrough(ts).pipeTo(ws).closed.then(() => ({ pauses }));
};

function potentiallySyncSetTimeout(fn, ms) {
  if (ms === 'sync') {
    fn();
  } else {
    setTimeout(fn, ms);
  }
}
