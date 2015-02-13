# Streams Standard

The streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The main spec is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file. We are also working on a number of potential extensions: see BinaryExtension.md and TeeStream.md.

Snapshots of any given commit or branch are available at specially-crafted URLs:

- https://streams.spec.whatwg.org/commit-snapshots/ contains snapshots of any given commit
- https://streams.spec.whatwg.org/branch-snapshots/ contains snapshots of the latest commit to any given branch

This repository also includes a polyfill and test suite under `reference-implementation/`. See the README under that directory for more details. The test suite is automatically deployed, in a form viable for running against browsers, to https://streams.spec.whatwg.org/tests/.


## Building the spec

To build the spec locally, [install Bikeshed](https://github.com/tabatkins/bikeshed/blob/master/docs/install.md) and then run `bikeshed spec` in the working directory.

Alternately, you can use the command

```
curl https://api.csswg.org/bikeshed/ -F file=@index.bs > index.html
```

to use Bikeshed's web interface without installing anything.
