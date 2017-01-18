# Reference Implementation and Tests

This folder contains a reference implementation of the streams standard, inside `lib/`. It also contains various tests, discussed below.

## Reference implementation

The reference implementation is meant to be a fairly close transcription of the spec into JavaScript. It is written in modern JavaScript and primarily tested in [Node.js](https://nodejs.org/en/); at least version 6.0.0 is required.

## Tests

Test coverage is not complete, but we do aim for it to be. Adding tests would be a great way to contribute to this project.

You can check the test coverage at any time by running `npm run coverage` in this folder.

To run all tests (and the lint step), run `npm test` in this folder.

### Legacy tests

The original tests are written using the [tape](https://github.com/substack/tape) framework. They live in the `test` subfolder of this folder.

- To run them, type `npm run legacy-test` in this folder.
- To run a specific test file, type e.g. `node run-tests.js test/readable-stream.js`.
- To run a specific test, change the source file's `test(...)` call to `test.only(...)`, then run `npm test`.

### Web platform tests

After we started implementing this in browsers, we realized that we should probably have written the tests in standard [web platform tests](https://github.com/w3c/web-platform-tests) format. Fixing this has been an ongoing effort, with major help from various community contributors.

- To run the web platform tests (including both the upstream ones and the to-upstream ones), type `npm run wpt` in this folder.
- To run specific test files, you can use a glob pattern, rooted at the streams directory: `npm run wpt -- "writable-streams/**"`

The test runner here is a Node.js emulated-DOM environment, with the reference implementation loaded into it.

#### Upstream web platform tests

The web platform tests for streams are found in the [streams directory](https://github.com/w3c/web-platform-tests/tree/master/streams) of the web platform tests repository, and maintained via pull requests to that repository. They are then pulled into this repository via a [Git submodule](https://git-scm.com/book/en/v2/Git-Tools-Submodules).

This means that in order to land a test change for these tests, you'll need to make a pull request to the web platform tests repository, and then update the submodule pointer in this repository (probably in the same pull request as your spec change). That can be done via the command

```
git submodule update --remote web-platform-tests
```

and then staging and commiting the submodule update.

#### To-upstream web platform tests

For parts of the spec that are still baking, we develop the tests alongside the spec in this repository, inside the `to-upstream-wpts` subfolder of this folder. Files can be added here alongside spec commits, and then one of the maintainers will take care of upstreaming to the web-platform-tests repository once the relevant part of the spec is mostly stable.

Some of the files in there, in `to-upstream-wpts/resources`, are duplicated from upstream, and care needs to be taken to synchronize them both ways.
