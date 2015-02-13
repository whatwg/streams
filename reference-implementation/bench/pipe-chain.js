import ReadableStream from '../lib/readable-stream';
import WritableStream from '../lib/writable-stream';
import TransformStream from '../lib/transform-stream';
import ByteLengthQueuingStrategy from '../lib/byte-length-queuing-strategy';

export default params => {
  let chunksSoFar = 0;
  let paused = false;
  let pauses = 0;

  let generateData;
  const rs = new ReadableStream({
    start(enqueue, close) {
      generateData = () => {
        if (paused) {
          return;
        }

        if (chunksSoFar++ >= params.underlyingSourceChunks) {
          close();
          return;
        }

        const chunk = new ArrayBuffer(params.underlyingSourceChunkSize);
        if (!enqueue(chunk)) {
          paused = true;
          ++pauses;
        }

        potentiallySyncSetTimeout(generateData, params.underlyingSourceChunkInterval);
      };

      potentiallySyncSetTimeout(generateData, params.underlyingSourceChunkInterval);
    },

    pull(enqueue, close) {
      paused = false;
      potentiallySyncSetTimeout(generateData, params.underlyingSourceChunkInterval);
    },

    strategy: new ByteLengthQueuingStrategy({ highWaterMark: params.readableStreamHWM })
  });

  const ts = new TransformStream({
    transform(chunk, enqueue, done) {
      const newChunk = new ArrayBuffer(params.underlyingSourceChunkSize * params.transformSizeMultiplier);
      const halfRate = params.transformRate === 'sync' ? params.transformRate : params.transformRate / 2;
      potentiallySyncSetTimeout(() => enqueue(newChunk), halfRate);
      potentiallySyncSetTimeout(done, params.transformRate);
    },
    writableStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformWritableHWM }),
    readableStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformReadableHWM })
  });

  const ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => potentiallySyncSetTimeout(resolve, params.underlyingSinkAckLatency));
    },

    strategy: new ByteLengthQueuingStrategy({ highWaterMark: params.writableStreamHWM })
  });

  return rs.pipeThrough(ts).pipeTo(ws).then(() => ({ pauses }));
};

function potentiallySyncSetTimeout(fn, ms) {
  if (ms === 'sync') {
    fn();
  } else {
    setTimeout(fn, ms);
  }
}
