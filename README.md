# Streams Standard

The streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The main spec is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file. We are also working on a potential extension in TeeStream.md.

Snapshots of any given commit or branch are available at specially-crafted URLs:

- https://streams.spec.whatwg.org/commit-snapshots/ contains snapshots of any given commit
- https://streams.spec.whatwg.org/branch-snapshots/ contains snapshots of the latest commit to any given branch

## Tests and reference implementation

This repository also includes a reference implementation and test suite under `reference-implementation/`. See the README under that directory for more details. The test suite is automatically deployed, in a form viable for running against browsers, to https://streams.spec.whatwg.org/tests/.

## Contribution guidelines

For guidelines on how to build and edit the spec and reference implementation, see [Contributing.md](Contributing.md).

## Code of conduct

We are committed to providing a friendly, safe and welcoming environment for all. Please read and respect the [WHATWG Code of Conduct](https://wiki.whatwg.org/wiki/Code_of_Conduct).
