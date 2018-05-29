# Streams Standard

The Streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The standard is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file.

Snapshots of any given commit are available at specially-crafted URLs:

- https://streams.spec.whatwg.org/commit-snapshots/ contains snapshots of any given commit

## Tests and reference implementation

This repository also includes a reference implementation and test suite under `reference-implementation/`. See the README under that directory for more details. We strive for every commit that changes the spec to also add tests, and to change the reference implementation in order to pass those tests.

## Contribution guidelines

For guidelines on how to build and edit the spec and reference implementation, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Merge policy

If you can commit to this repository, see the
[WHATWG Maintainer Guidelines](https://github.com/whatwg/meta/blob/master/MAINTAINERS.md).

## Code of conduct

We are committed to providing a friendly, safe, and welcoming environment for all. Please read and respect the [WHATWG Code of Conduct](https://whatwg.org/code-of-conduct).
