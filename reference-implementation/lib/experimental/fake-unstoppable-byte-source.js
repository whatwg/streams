// WIP WIP WIP WIP

class FakeUnstoppablePushSource {
  constructor(count) {
    this._count = count;

    setTimeout(this._push.bind(this), 0);
  }

  _push() {
    if (this._count == 0) {
      this.onend();
      return;
    }

    this.ondata('foo');
    --this._count;

    setTimeout(this._push.bind(this), 0);
  }
}

test('Adapting unstoppable push source', t => {
  class Source {
    constructor() {
      this._queue = [];
    }

    init(delegate) {
      this._pushSource = new FakeUnstoppablePushSource(10);

      t.equal(typeof delegate.markWaiting,  'function', 'markWaiting is a function');
      t.equal(typeof delegate.markReadable, 'function', 'markReadable is a function');
      t.equal(typeof delegate.markDrained, 'function', 'markDrained is a function');
      t.equal(typeof delegate.markErrored, 'function', 'markErrored is a function');

      this._readableStreamDelegate = delegate;

      this._pushSource.ondata = chunk => {
        this._queue.push({type: 'data', data: chunk});
        delegate.markReadable();
      };

      this._pushSource.onend = () => {
        this._queue.push({type: 'close'});
        delegate.markReadable();
      };

      this._pushSource.onerror = () => {
        this._queue = [];
        delegate.markErrored();
      };
    }

    onWindowUpdate(v) {
    }

    read() {
      if (this._queue.length === 0) {
        throw new TypeError('not readable');
      }

      const entry = this._queue.shift();

      if (this._queue.length === 0) {
        if (entry.type === 'close') {
          this._readableStreamDelegate.markDrained();
          return ReadableStream.EOS;
        } else {
          this._readableStreamDelegate.markWaiting();
          return entry.data;
        }
      }

      return entry;
    }

    cancel() {
      this._queue = [];

      this._pushSource.close();
    }
  }

  const source = new Source();
  const readableStream = new ThinStreamReader(source);

  let count = 0;
  function pump() {
    for (;;) {
      if (readableStream.state === 'waiting') {
        Promise.race([readableStream.readable, readableStream.errored])
          .then(pump)
          .catch(e => {
            t.fail(e);
            t.end();
          });
        return;
      } else if (readableStream.state === 'readable') {
        const data = readableStream.read();
        if (count === 10) {
          t.equal(data, ReadableStream.EOS);
          t.end();
          return;
        } else {
          t.equal(data, 'foo');
          ++count;
        }
      } else if (readableStream.state === 'drained') {
        t.fail();
        t.end();
        return;
      } else if (readableStream.state === 'cancelled') {
        t.fail();
        t.end();
        return;
      } else if (readableStream.state === 'errored') {
        t.fail();
        t.end();
        return;
      } else {
        t.fail(readableStream.state);
        t.end();
        return;
      }
    }
  }
  pump();
});
