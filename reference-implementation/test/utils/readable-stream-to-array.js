export default function readableStreamToArray(readable) {
  const chunks = [];
  const reader = readable.getReader();

  return pump();

  function pump() {
    return reader.read().then(({ value, done }) => {
      if (done) {
        reader.releaseLock();
        return chunks;
      }

      chunks.push(value);
      return pump();
    });
  }
}
