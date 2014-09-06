# Streams API Tee Stream Extension

A "tee stream" is a writable stream which, when written to, itself writes to multiple destinations. It aggregates backpressure and abort signals from those destinations, propagating the appropriate aggregate signals backward.

This design is fairly speculative and hasn't even been prototyped yet. It should be considered basically scratchwork at this point, which is why we're keeping it in a separate document.

```js
class TeeStream extends WritableStream {
    constructor() {
        this.[[outputs]] = [];

        super({
            write(chunk) {
                return Promise.all(this.[[outputs]].map(o => o.dest.write(chunk)));
            },
            close() {
                const outputsToClose = this.[[outputs]].filter(o => o.close);
                return Promise.all(outputsToClose.map(o => o.dest.close()));
            },
            abort(reason) {
                return Promise.all(this.[[outputs]].map(o => o.dest.abort(reason)));
            }
        });
    }

    addOut(dest, { close = true } = {}) {
        this.[[outputs]].push({ dest, close });
    }
}
```

