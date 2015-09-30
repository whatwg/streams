# Reference Implementation and Tests

This folder contains a reference implementation of the streams standard, inside `lib/`. It also contains a test suite inside `test/`.

## Reference Implementation

The reference implementation is meant to be a fairly close transcription of the spec into JavaScript. It is written in ES6 and transpiled with [Traceur](https://github.com/google/traceur-compiler).

## Tests

Test coverage is not complete, but we do aim for it to be. Adding tests would be a great way to contribute to this project.

### Original Tests

The original tests are also written in ES6, using the [tape](https://github.com/substack/tape) framework.

- To run them, type `npm test` in this folder.
- To run a specific test file, type e.g. `node test-runner test/readable-stream.js`.
- To run a specific test, change the source file's `test(...)` call to `test.only(...)`, then run `npm test`.

### Web Platform Tests

After we started implementing this in browsers, we realized that we should probably have written the tests in standard [web platform tests](https://github.com/w3c/web-platform-tests) format.

Actually, WebKit noticed this first, and [converted all the tests](https://github.com/Igalia/streams/tree/webkit-tests/reference-implementation/webkit/reference-implementation). So we're starting to take their work and port it back into this repo. While we do so, we're splitting things up a bit so it's easier for implementers to work on only certain sections of the spec at a time, e.g. readable streams first.

Anyway, one thing to keep an eye out for is that due to this porting work, the coding style and level of ES6 feature usage is going to vary a decent bit.

To run the web platform tests against the reference implementation from within Node.js, type `npm run wpt` in this folder.
