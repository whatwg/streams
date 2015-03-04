/// WIP WIP WIP WIP


  pull(container) {
    if (container === undefined) {
      throw new TypeError('container is undefined');
    }
    if (container.constructor !== Uint8Array) {
      throw new TypeError('the only supported container is Uint8Array');
    }

    this._pendingPulls.push(container);
    this._resolvePendingPulls();
  }

  _resolvePendingPulls() {
    let bytesConsumed = 0;
    let enqueued = false;

    while (this._pendingPulls.length > 0) {
      const destView = this._pendingPulls.shift();
      let destViewPosition = 0;

      while (this._shared._queue.length > 0) {
        if (destViewPosition === destView.byteLength) {
          this._readableValueQueue.push(destView);
          enqueued = true;
          break;
        }

        const entry = this._shared._queue[0];

        const srcView = entry.value;
        if (srcView === undefined || srcView.constructor !== Uint8Array) {
          console.log('not reached');
        }

        const bytesToCopy = Math.min(destView.byteLength - destViewPosition, srcView.byteLength);
        destView.set(srcView.subarray(0, bytesToCopy), destViewPosition);
        destViewPosition += bytesToCopy;

        if (bytesToCopy === srcView.byteLength) {
          this._shared._queue.shift();
        } else {
          this._shared[0] = srcView.subarray(bytesToCopy);
        }
        bytesConsumed += bytesToCopy;
      }

      if (this._shared._queue.length === 0) {
        this._readableValueQueue.push(destView.subarray(0, destViewPosition));
        enqueued = true;

        if (this._shared._draining) {
          while (this._pendingPulls.length > 0) {
            const destView = this._pendingPulls.shift();
            this._readableValueQueue.push(destView.subarray());
          }
        }
        break;
      }
    }

    this._delegate.markReadable();

    this._shared._queueSize -= bytesConsumed;
    this._sink.onQueueConsume();
  }
