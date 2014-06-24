import ReadableStream from '../../lib/readable-stream';
import SequentialPullSource from './sequential-pull-source';

export default function sequentialReadableStream(limit, options) {
  var sequentialSource = new SequentialPullSource(limit, options);

  var stream = new ReadableStream({
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

    pull(enqueue, finish, error) {
      sequentialSource.read((err, done, chunk) => {
        if (err) {
          error(err);
        } else if (done) {
          sequentialSource.close(err => {
            if (err) {
              error(err);
            }
            finish();
          });
        } else {
          enqueue(chunk);
        }
      });
    }
  });

  stream.source = sequentialSource;

  return stream;
};
