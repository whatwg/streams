# Reference Implementation and Tests

This folder contains a reference implementation of the streams standard, inside `lib/`. It also contains a test suite inside `test/`.

## Reference Implementation

The reference implementation is meant to be a fairly close transcription of the spec into JavaScript. It is written in ES6 and transpiled with [Traceur](https://github.com/google/traceur-compiler).

## Tests

The tests are also written in ES6. They use the [tape](https://github.com/substack/tape) framework.

- To run them, type `npm test` in this folder.
- To run a specific test file, type e.g. `node test-runner test/readable-stream.js`.
- To run a specific test, change the source file's `test(...)` call to `test.only(...)`, then run `npm test`.

Test coverage is not complete, but we do aim for it to be. Adding tests would be a great way to contribute to this project.
