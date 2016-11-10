'use strict';

function IsThenable(x) {
  return typeof x === 'object' && typeof x.then === 'function';
}

function InvokeAndRecordEvent(func, args, event1, events) {
  let result;
  event1.begun = true;
  events.push(event1);
  try {
    if (func) {
      result = func(...args);
    }
  } catch (resultE) {
    event1.thrownError = resultE;
    throw resultE;
  }
  event1.fulfilled = !IsThenable(result);
  if (!event1.fulfilled) {
    const event2 = Object.assign({}, event1);
    event2.begun = false;
    result = result.then(() => {
      event2.fulfilled = true;
      events.push(event2);
    }, e => {
      event2.fulfilled = false;
      event2.thrownError = e;
      events.push(event2);
      throw e;
    });
  }

  return result;
}

self.recordingReadableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  let startPromise;
  const events = [];
  const stream = new ReadableStream({
    start(controller) {
      controllerToCopyOver = controller;

      const event = { method: 'start' };
      const result = InvokeAndRecordEvent(extras.start, [controller], event, events);
      startPromise = Promise.resolve(result);
      return result;
    },
    pull(controller) {
      const event = { method: 'pull' };
      return InvokeAndRecordEvent(extras.pull, [controller], event, events);
    },
    cancel(reason) {
      const event = { method: 'cancel', value: reason };
      return InvokeAndRecordEvent(extras.cancel, [reason], event, events);
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  Object.defineProperty(stream, 'events', {
    get() {
      return events.filter(e => e.begun && e.method !== 'start').reduce((a, e) => {
        a.push(e.method);
        if ('value' in e) {
          a.push(e.value);
        }
        return a;
      }, []);
    }
  });
  Object.defineProperty(stream, 'eventsWithoutPulls', {
    get() {
      return events.filter(e => e.begun && e.method !== 'start' && e.method !== 'pull').reduce((a, e) => {
        a.push(e.method);
        if ('value' in e) {
          a.push(e.value);
        }
        return a;
      }, []);
    }
  });
  stream.startPromise = startPromise;

  return stream;
};

self.recordingWritableStream = (extras = {}, strategy) => {
  let controllerToCopyOver;
  let startPromise;
  const events = [];
  const stream = new WritableStream({
    start(controller) {
      controllerToCopyOver = controller;

      const event = { method: 'start' };
      const result = InvokeAndRecordEvent(extras.start, [controller], event, events);
      startPromise = Promise.resolve(result);
      return result;
    },
    write(chunk) {
      const event = { method: 'write', value: chunk };
      return InvokeAndRecordEvent(extras.write, [chunk], event, events);
    },
    close(...args) {
      assert_array_equals(args, [controllerToCopyOver], 'close must always be called with the controller');

      const event = { method: 'close' };
      return InvokeAndRecordEvent(extras.close, [], event, events);
    },
    abort(e) {
      const event = { method: 'abort', value: e };
      return InvokeAndRecordEvent(extras.abort, [e], event, events);
    }
  }, strategy);

  stream.controller = controllerToCopyOver;
  Object.defineProperty(stream, 'events', {
    get() {
      return events.filter(e => e.begun && e.method !== 'start').reduce((a, e) => {
        a.push(e.method);
        if ('value' in e) {
          a.push(e.value);
        }
        return a;
      }, []);
    }
  });
  stream.startPromise = startPromise;

  return stream;
};
