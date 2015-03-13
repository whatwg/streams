export default function readableStreamToArray(readable, reader = readable.getReader()) {
  const chunks = [];

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
