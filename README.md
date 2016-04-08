# Streams Standard

The streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The main spec is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file. We are also working on a potential extension in TeeStream.md.

Snapshots of any given commit or branch are available at specially-crafted URLs:

- https://streams.spec.whatwg.org/commit-snapshots/ contains snapshots of any given commit
- https://streams.spec.whatwg.org/branch-snapshots/ contains snapshots of the latest commit to any given branch

## Tests and reference implementation

This repository also includes a reference implementation and test suite under `reference-implementation/`. See the README under that directory for more details. The test suite is automatically deployed, in a form viable for running against browsers, to https://streams.spec.whatwg.org/tests/.

## Building the spec

Building the spec is a two-step process. First, the majority of the conversion work is done via [Bikeshed](https://github.com/tabatkins/bikeshed). Second, we run a custom portion of the [Ecmarkup](https://github.com/bterlson/ecmarkup) pipeline to convert the algorithms from [Ecmarkdown](https://github.com/domenic/ecmarkdown) syntax into HTML, and to automatically add cross-references. This second step requires a recent version of [Node.js](https://nodejs.org/en/) to be installed.

### Local "deploy"

To get the full build experience, including commit and branch snapshots, you can run

```
bash ./deploy.sh --local
```

This will output a bunch of files to the `streams.spec.whatwg.org` directory, equaling those that would be uploaded to the server on deploy. It will use Bikeshed hosted on the CSSWG server, so you do not need to install Bikeshed locally (but will need Node.js).

### Local Watch

If you have Bikeshed [installed locally](https://github.com/tabatkins/bikeshed/blob/master/docs/install.md), and have run `npm install`, you can try running

```
npm run local-watch
```

to start a watcher on `index.bs` that will update `index.html` as you edit.

## Code of conduct

We are committed to providing a friendly, safe and welcoming environment for all. Please read and respect the [WHATWG Code of Conduct](https://wiki.whatwg.org/wiki/Code_of_Conduct).
