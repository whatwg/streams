# Extra Streams API Examples

Many examples of using and creating streams are given in-line in the specification. This document contains a few that are a bit more in-depth than normal, and so haven't made it in. Maybe we should port them over, or maybe just leave them here.

## Readable Streams

### Buffering the Entire Stream Into Memory

This function uses the reading APIs to buffer the entire stream in memory and give a promise for the results, defeating the purpose of streams but educating us while doing so:

```js
function readableStreamToArray(readable) {
  const chunks = [];

  return pump();

  function pump() {
    return readable.read().then(({ value, done }) => {
      if (done) {
        return chunks;
      }

      chunks.push(value);
      return pump();
    });
  }
}

readableStreamToArray(myStream).then(chunks => {
  console.log("Number of chunks:", chunks.length);
  console.log("First chunk:", chunks[0]);
  console.log("Last chunk:", chunks[chunks.length - 1]);
})
```

We can also write this using the [async function syntax](https://github.com/lukehoban/ecmascript-asyncawait/) proposed for ES2016:

```js
async function readableStreamToArray(readable) {
  const chunks = [];

  let result;
  while (!(result = await readable.read()).done) {
    chunks.push(result.value);
  }

  return chunks;
}
```

## Writable Streams

### Reporting Incremental Progress

Even if we queue up all our writes immediately, as in [the second example in the spec](https://streams.spec.whatwg.org/#ws-intro), we can still add promise handlers to report when they succeed or fail.

```js
function writeArrayToStreamWithReporting(array, writableStream) {
  for (const chunk of array) {
    writableStream.write(chunk)
      .then(() => console.log("Wrote " + chunk + " successfully"))
      .catch(e => console.error("Failed to write " + chunk + "; error was " + e));
  }

  return writableStream.close();
}

writeArrayToStream([1, 2, 3], myStream)
  .then(() => console.log("All done!"))
  .catch(e => console.error("Error with the stream: " + e));
```

Let's say `myStream` was able to successfully write all of the chunks. Then you'd get an output like:

```
Wrote 1 successfully
Wrote 2 successfully
Wrote 3 successfully
All done!
```

Whereas, let's say it was able to write chunk 1, but failed to write chunk 2, giving an error of `"Disk full"`. In that case, the call to `write` for chunk 3 would also fail with this error, as would the call to `close`:

```
Wrote 1 successfully
Failed to write 2; error was "Disk full"
Failed to write 3; error was "Disk full"
Error with the stream: "Disk full"
```

### Paying Attention to Backpressure Signals

Most writable stream examples use the writable streams internal queue to indiscriminately write to it, counting on the stream itself to handle an excessive number of writes (i.e., more than could be reasonably written to the underlying sink). In reality, the underlying sink will be communicating backpressure signals back to you through the writable stream's `state` property. When the stream's `state` property is `"writable"`, the stream is ready to accept more data—but when it is `"waiting"`, you should, if possible, avoid writing more data.

It's a little hard to come up with a realistic example where you can do something useful with this information, since most of them involve readable streams, and in that case, you should just be piping the streams together. But here's one that's only slightly contrived, where we imagine prompting the user for input via a promise-returning `prompt()` function—and disallowing the user from entering more input until the writable stream is ready to accept it.

```js
function promptAndWrite(myStream) {
  if (writableStream.state === "writable") {
    prompt("Enter data to write to the stream").then(chunk => {
      if (chunk !== "DONE") {
        writableStream.write(chunk);
        promptAndWrite();
      } else {
        writableStream.close()
          .then(() => console.log("Successfully closed"))
          .catch(e => console.error("Failed to close: ", e));
      }
    });
  } else if (writableStream.state === "waiting") {
    console.log("Waiting for the stream to flush to the underlying sink, please hold...");
    writableStream.ready.then(promptAndWrite);
  } else if (writableStream.state === "errored") {
    console.error("Error writing; this session is over!");
  }
}

promptAndWrite(myStream);
```
