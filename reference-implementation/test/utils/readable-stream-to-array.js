export default function readableStreamToArray(readable) {
  return new Promise((resolve, reject) => {
    var chunks = [];

    readable.closed.then(() => resolve(chunks), reject);
    pump();

    function pump() {
      while (readable.state === 'readable') {
        chunks.push(readable.read());
      }

      if (readable.state === 'waiting') {
        readable.ready.then(pump);
      }
    }
  });
}
