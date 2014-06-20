import ReadableStream from '../../lib/readable-stream';
import SequentialPullSource from './sequential-pull-source';

export default function sequentialReadableStream(limit, options) {
  var sequentialSource = new SequentialPullSource(limit, options);

  var stream = new ReadableStream({
    start : function () {
      return new Promise(function (resolve, reject) {
        sequentialSource.open(function (err) {
          if (err) reject(err);
          resolve();
        });
      });
    },

    pull : function (push, finish, error) {
      sequentialSource.read(function (err, done, data) {
        if (err) {
          error(err);
        } else if (done) {
          sequentialSource.close(function (err) {
            if (err) error(err);
            finish();
          });
        } else {
          push(data);
        }
      });
    }
  });

  stream.source = sequentialSource;

  return stream;
};
