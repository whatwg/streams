'use strict';
const SequentialPullSource = require('./sequential-pull-source.js');

module.exports = (limit, options) => {
  const sequentialSource = new SequentialPullSource(limit, options);

  const stream = new ReadableStream({
    start() {
      return new Promise((resolve, reject) => {
        sequentialSource.open(err => {
          if (err) {
            reject(err);
          }
          resolve();
        });
      });
    },

    pull(c) {
      return new Promise((resolve, reject) => {
        sequentialSource.read((readErr, done, chunk) => {
          if (readErr) {
            reject(readErr);
          } else if (done) {
            sequentialSource.close(closeErr => {
              if (closeErr) {
                reject(closeErr);
              }
              c.close();
              resolve();
            });
          } else {
            c.enqueue(chunk);
            resolve();
          }
        });
      });
    }
  });

  stream.source = sequentialSource;

  return stream;
};
