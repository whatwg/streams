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

  var ts = new TransformStream({
    transform(chunk, enqueue, done) {
      var newChunk = new ArrayBuffer(params.underlyingSourceChunkSize * params.transformSizeMultiplier);
      potentiallySyncSetTimeout(() => enqueue(newChunk), params.transformRate / 2);
      potentiallySyncSetTimeout(done, params.transformRate);
    },
    writableStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformWritableHWM }),
    readableStrategy: new ByteLengthQueuingStrategy({ highWaterMark: params.transformReadableHWM })
  });

  var ws = new WritableStream({
    write(chunk) {
      return new Promise(resolve => potentiallySyncSetTimeout(resolve, params.underlyingSinkAckLatency));
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
