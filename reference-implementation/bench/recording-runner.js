var fs = require('fs');
var mkdirpSync = require('mkdirp').sync;
var path = require('path');

import Runner from './runner-base.js';

var directory = path.resolve(__dirname, 'results');
mkdirpSync(directory);

var results = {};

var runner = new Runner((time, data, values) => {
  results[JSON.stringify(values)] = { time: time, data: data };
});

runner.run()
  .then(() => {
    var sanitizedDate = (new Date()).toISOString().replace(/[-:.]/g, '');
    var filename = path.resolve(directory, sanitizedDate + '.json');
    fs.writeFileSync(filename, JSON.stringify(results, undefined, 2));
  })
  .catch(console.error);
