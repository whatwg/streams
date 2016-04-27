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
        sequentialSource.read((err, done, chunk) => {
          if (err) {
            reject(err);
          } else if (done) {
            sequentialSource.close(err => {
              if (err) {
                reject(err);
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
