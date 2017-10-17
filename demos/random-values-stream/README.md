# Random Values Readable Stream

Random Values Cryptography Stream generates random values in a readable stream using the [getRandomValues](https://developer.mozilla.org/en-US/docs/Web/API/RandomSource/getRandomValues) in the [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API). The stream is then piped through a transform stream to make the output look prettier and then eventually written to a writable stream with an underlying sink that has relation to the User Interface.

## About the Code

A function called `pipeStream` initializes all the streams calling their respective methods along 
with the arguments required and pipes the stream using the following code below

```js
readableStream.pipeThrough(transformStream).pipeTo(writableStream);
```
