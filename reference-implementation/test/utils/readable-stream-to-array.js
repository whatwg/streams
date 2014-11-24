export default function readableStreamToArray(readable) {
  var chunks = [];

  pump();
  return readable.closed.then(() => chunks);

  function pump() {
    while (readable.state === "readable") {
      chunks.push(readable.read());
    }

    if (readable.state === "waiting") {
      readable.ready.then(pump);
    }

    // Otherwise the stream is "closed" or "errored", which will be handled above.
  }
}
