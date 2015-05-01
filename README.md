# Streams Standard

The streams standard provides APIs for creating, composing, and consuming streams of data. These streams are designed to map efficiently to low-level I/O primitives, and allow easy composition with built-in backpressure and queuing.

The main spec is available at https://streams.spec.whatwg.org/, generated from the `index.bs` file. We are also working on a number of potential extensions: see BinaryExtension.md and TeeStream.md.

Snapshots of any given commit or branch are available at specially-crafted URLs:

- https://streams.spec.whatwg.org/commit-snapshots/ contains snapshots of any given commit
- https://streams.spec.whatwg.org/branch-snapshots/ contains snapshots of the latest commit to any given branch

This repository also includes a polyfill and test suite under `reference-implementation/`. See the README under that directory for more details. The test suite is automatically deployed, in a form viable for running against browsers, to https://streams.spec.whatwg.org/tests/.


## Building the spec

Building the spec is a two-step process. First, the majority of the conversion work is done via [Bikeshed](https://github.com/tabatkins/bikeshed). Second, we run a custom portion of the [Ecmarkup](https://github.com/bterlson/ecmarkup) pipeline to convert the algorithms from [Ecmarkdown](https://github.com/domenic/ecmarkdown) syntax into HTML, and to automatically add cross-references. This second step requires [io.js](https://iojs.org/) to be installed.

### Bikeshed

To run Bikeshed locally, [install Bikeshed](https://github.com/tabatkins/bikeshed/blob/master/docs/install.md) and then run `bikeshed spec` in the working directory.

Alternately, you can use the command

```
curl https://api.csswg.org/bikeshed/ -F md-Text-Macro="SNAPSHOT-LINK dummy" -F file=@index.bs > index.tmp.html
```

to use Bikeshed's web interface without installing anything.

### Ecmarkup

To run the Ecmarkup step, be sure you've done `npm install` in the root directory, then run

```
npm run ecmarkupify index.tmp.html index.html
```

### Local "Deploy"

To get the full build experience, including commit and branch snapshots, you can run

```
bash ./deploy.sh --local
```

This will output a bunch of files to the `streams.spec.whatwg.org` directory, equaling those that would be uploaded to the server on deploy.

### Local Watch

If you have Bikeshed installed locally, and have run `npm install`, you can try running

```
npm run local-watch
```

to start a watcher on `index.bs` that will update `index.html` as you edit.
