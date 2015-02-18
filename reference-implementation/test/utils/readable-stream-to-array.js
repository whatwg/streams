export default function readableStreamToArray(readable) {
  const chunks = [];

  return pump();

  function pump() {
    return readable.read().then(chunk => {
      if (chunk === ReadableStream.EOS) {
        return chunks;
      }

      chunks.push(chunk);
      return pump();
    });
  }
}
