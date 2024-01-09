# Streams Standard contributor guidelines

These are the guidelines for contributing to the Streams Standard. First see the [WHATWG contributor guidelines](https://github.com/whatwg/meta/blob/main/CONTRIBUTING.md).

We label [good first issues](https://github.com/whatwg/streams/labels/good%20first%20issue) that you could help us fix, to get a taste for how to submit pull requests, how the build process works, and so on.

## Spec editorial conventions

In general, follow existing practice.

Wrap lines to 100 columns.

Use single-space indents.

Do not introduce explicit `<p>` tags. (Bikeshed does this automatically.)

Mark up definitions [appropriately](https://speced.github.io/bikeshed/#definitions). This is mostly applicable when defining new classes or methods; follow the existing examples in the spec.

Use cross-reference [autolinking](https://speced.github.io/bikeshed/#autolinking) liberally. This generally amounts to writing references to "definitions" as `[=term=]`, and writing references to classes or methods as `{{ClassName}}` or `{{ClassName/methodName()}}`.

When writing examples or notes, JavaScript variables and values are enclosed in `<code>` tags, not in `<var>` tags.

Use abstract operations to factor out shared logic used by multiple public APIs, or by multiple other abstract operations.

## Reference implementation style

Wrap lines to 120 columns.

Use two-space indents.

Alphabetize imports.

Use single quotes.

Pass ESLint.
