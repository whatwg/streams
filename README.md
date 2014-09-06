# Streams Standard

The streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The main spec is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file. We are also working on a number of potential extensions: see BinaryExtension.md and TeeStream.md.

This repository also includes a polyfill and test suite under `reference-implementation/`. See the README under that directory for more details.
