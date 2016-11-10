'use strict';

self.recordingReadableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  const events = [];
  const eventsWithoutPulls = [];
  const stream = new ReadableStream({
    start(controller) {
      controllerToCopyOver = controller;

      if (extras.start) {
        return extras.start(controller);
      }

      return undefined;
    },
    pull(controller) {
      events.push('pull');

      if (extras.pull) {
        return extras.pull(controller);
      }

      return undefined;
    },
    cancel(reason) {
      events.push('cancel', reason);
      eventsWithoutPulls.push('cancel', reason);

      if (extras.cancel) {
        return extras.cancel(reason);
      }

      return undefined;
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  stream.events = events;
  stream.eventsWithoutPulls = eventsWithoutPulls;

  return stream;
};

self.recordingWritableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  const events = [];
  const stream = new WritableStream({
    start(controller) {
      controllerToCopyOver = controller;

      if (extras.start) {
        return extras.start(controller);
      }

      return undefined;
    },
    write(chunk) {
      events.push('write', chunk);

      if (extras.write) {
        return extras.write(chunk);
      }

      return undefined;
    },
    close(...args) {
      assert_array_equals(args, [controllerToCopyOver], 'close must always be called with the controller');

      events.push('close');

      if (extras.close) {
        return extras.close();
      }

      return undefined;
    },
    abort(e) {
      events.push('abort', e);

      if (extras.abort) {
        return extras.abort(e);
      }

      return undefined;
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  stream.events = events;

  return stream;
};
