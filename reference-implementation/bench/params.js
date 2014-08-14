export default {
  underlyingSourceChunks: [1, 16],
  underlyingSourceChunkSize: [1024],
  underlyingSourceRate: ['sync', 0, 5, 15],
  readableStreamHWM: [0, 4 * 1024],
  transformRate: ['sync', 0, 5, 15],
  transformSizeMultiplier: [0.3, 2],
  transformInputHWM: [0],
  transformOutputHWM: [0],
  writableStreamHWM: [0, 4 * 1024],
  underlyingSinkRate: ['sync', 0, 5, 15]
};
