const fs = require('fs');
const mkdirpSync = require('mkdirp').sync;
const path = require('path');

import Runner from './runner-base.js';

const directory = path.resolve(__dirname, 'results');
mkdirpSync(directory);

const results = {};

const runner = new Runner((time, data, values) => {
  results[JSON.stringify(values)] = { time: time, data: data };
});

runner.run()
  .then(() => {
    const sanitizedDate = (new Date()).toISOString().replace(/[-:.]/g, '');
    const filename = path.resolve(directory, sanitizedDate + '.json');
    fs.writeFileSync(filename, JSON.stringify(results, undefined, 2));
  })
  .catch(console.error);
