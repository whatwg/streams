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

After we started implementing this in browsers, we realized that we should probably have written the tests in standard [web platform tests](https://github.com/w3c/web-platform-tests) format. Fixing this has been an ongoing effort, with major help from WebKit contributors, who ported the initial set of tests from our original format.

The web platform tests for streams are found in the [streams directory](https://github.com/w3c/web-platform-tests/tree/master/streams) of the web platform tests repository, and maintained via pull requests to that repository.

For local development while working on the spec, you can run

```
bash ./update-web-platform-tests.sh
```

to clone the web platform tests repository locally, and then use

```
npm run wpt
```

to run the streams web platform tests against the reference implementation, inside a Node.js emulated-DOM environment. If you make changes to the tests locally, for example while making a spec change, please send them as a pull request to the web platform tests repository.
