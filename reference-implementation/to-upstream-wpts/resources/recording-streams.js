'use strict';
// This file already exists upstream. We are duplicating and updating it here. Be sure to merge with the existing one
// when upstreaming.

self.recordingReadableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  const stream = new ReadableStream({
    start(controller) {
      controllerToCopyOver = controller;

      if (extras.start) {
        return extras.start(controller);
      }

      return undefined;
    },
    pull(controller) {
      stream.events.push('pull');

      if (extras.pull) {
        return extras.pull(controller);
      }

      return undefined;
    },
    cancel(reason) {
      stream.events.push('cancel', reason);
      stream.eventsWithoutPulls.push('cancel', reason);

      if (extras.cancel) {
        return extras.cancel(reason);
      }

      return undefined;
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  stream.events = [];
  stream.eventsWithoutPulls = [];

  return stream;
};

self.recordingWritableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  const stream = new WritableStream({
    start(controller) {
      controllerToCopyOver = controller;

      if (extras.start) {
        return extras.start(controller);
      }

      return undefined;
    },
    write(chunk) {
      stream.events.push('write', chunk);

      if (extras.write) {
        return extras.write(chunk);
      }

      return undefined;
    },
    close(...args) {
      assert_array_equals(args, [controllerToCopyOver], 'close must always be called with the controller');

      stream.events.push('close');

      if (extras.close) {
        return extras.close();
      }

      return undefined;
    },
    abort(e) {
      stream.events.push('abort', e);

      if (extras.abort) {
        return extras.abort(e);
      }

      return undefined;
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  stream.events = [];

  return stream;
};

self.recordingTransformStream = (extras = {}, writableStrategy, readableStrategy) => {
  let controllerToCopyOver;
  const stream = new TransformStream({
    start(controller) {
      controllerToCopyOver = controller;

      if (extras.start) {
        return extras.start(controller);
      }

      return undefined;
    },

    transform(chunk, controller) {
      stream.events.push('transform', chunk);

      if (extras.transform) {
        return extras.transform(chunk, controller);
      }

      controller.enqueue(chunk);

      return undefined;
    },

    flush(controller) {
      stream.events.push('flush');

      if (extras.flush) {
        return extras.flush(controller);
      }

      return undefined;
    }
  }, writableStrategy, readableStrategy);

  stream.controller = controllerToCopyOver;
  stream.events = [];

  return stream;
};
