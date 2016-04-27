'use strict';

module.exports = (readable, reader = readable.getReader()) => {
  const chunks = [];

  return pump();

  function pump() {
    return reader.read().then(({ value, done }) => {
      if (done) {
        return chunks;
      }

      chunks.push(value);
      return pump();
    });
  }
};
