# Contribution guidelines for the Streams Standard

## Spec editorial conventions

Wrap lines to 120 columns. (This is not yet consistently followed.)

Use two-space indents.

Do not introduce explicit `<p>` tags. (Bikeshed does this automatically.)

Use "let" for introducing new local variables. Use "set" for updating existing variables or internal slots.

Mark up definitions [appropriately](https://github.com/tabatkins/bikeshed/blob/master/docs/definitions-autolinks.md#definitions). This is mostly applicable when defining new classes or methods; follow the existing examples in the spec.

Mark up abstract operations with `throws` or `nothrow` attributes in their heading tags, according to whether or not they can ever return an abrupt completion.

Use cross-reference [autolinking](https://github.com/tabatkins/bikeshed/blob/master/docs/definitions-autolinks.md#autolinking) liberally. This generally amounts to writing references to "definitions" as `<a>term</a>`, and writing references to classes or methods as `{{ClassName}}` or `{{ClassName/methodName()}}`.

When writing examples or notes, JavaScript variables and values are enclosed in `<code>` tags, not in `<var>` tags.

Use abstract operations in the following scenarios:

- To factor out shared logic used by multiple public APIs, or by multiple other abstract operations. _Example: ReadableByteStreamControllerEnqueueChunkToQueue_.
- To factor out operations that should be called by other specifications. Other specifications do not require checking of arguments, argument parsing, and other invariants; we assume they use abstract operations appropriately, and so we don't need to enforce correctness by throwing an error if not. Thus we often let the public API enforce invariants before calling to an abstract operation that assumes they hold already. _Example: ReadableStreamDefaultControllerClose_.

## Reference implementation style

Wrap lines to 120 columns.

Use two-space indents.

Alphabetize imports.

Use single quotes.

## Commit guidelines

Follow the [guidelines for writing good commit messages](https://github.com/erlang/otp/wiki/Writing-good-commit-messages).

Merge commits are not allowed; history must stay linear.

If you are updating the spec, also update the corresponding parts of the reference implementation where applicable, in the same commit.

## Building the spec

Building the spec is a two-step process. First, the majority of the conversion work is done via [Bikeshed](https://github.com/tabatkins/bikeshed). Second, we run a custom portion of the [Ecmarkup](https://github.com/bterlson/ecmarkup) pipeline to convert the algorithms from [Ecmarkdown](https://github.com/domenic/ecmarkdown) syntax into HTML, and to automatically add cross-references. This second step requires a recent version of [Node.js](https://nodejs.org/en/) to be installed.

### Local "deploy"

To get the full build experience, including commit and branch snapshots, you can run

```
bash ./deploy.sh --local
```

This will output a bunch of files to the `streams.spec.whatwg.org` directory, equaling those that would be uploaded to the server on deploy. It will use Bikeshed hosted on the CSSWG server, so you do not need to install Bikeshed locally (but will need Node.js).

### Local watch

If you have Bikeshed [installed locally](https://github.com/tabatkins/bikeshed/blob/master/docs/install.md), and have run `npm install`, you can try running

```
npm run local-watch
```

to start a watcher on `index.bs` that will update `index.html` as you edit.
