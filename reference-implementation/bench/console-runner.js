const util = require('util');
const ms = require('ms');

import Runner from './runner-base.js';

const runner = new Runner((time, data, values, number) => {
  time = time/1e6;
  values = JSON.stringify(values);
  data = util.format(data);
  console.log(`(${number}/${runner.totalCases}) ${values}: ${time} ms, ${data}`);
});

console.log(`About to run ${runner.totalCases} cases`);

const start = Date.now();
runner.run()
  .then(() => console.log(`Total time elapsed: ${ms(Date.now() - start, { long: true })}`))
  .catch(console.error);
