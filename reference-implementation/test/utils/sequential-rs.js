import SequentialPullSource from './sequential-pull-source';

export default function sequentialReadableStream(limit, options) {
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

    pull(enqueue, close) {
      return new Promise((resolve, reject) => {
        sequentialSource.read((err, done, chunk) => {
          if (err) {
            reject(err);
          } else if (done) {
            sequentialSource.close(err => {
              if (err) {
                reject(err);
              }
              close();
              resolve();
            });
          } else {
            enqueue(chunk);
            resolve();
          }
        });
      });
    }
  });

  stream.source = sequentialSource;

  return stream;
};
