const sandwich = require('sandwich');

import params from './params';
import scenario from './pipe-chain';

const keys = Object.keys(params);

export default class BenchRunner {
  constructor(onResult, { maxCases = Infinity } = {}) {
    this._iterator = sandwich(...keys.map(k => params[k]));
    this._currentIteration = 0;

    this._onResult = onResult;

    this.totalCases = Math.min(maxCases, this._iterator.possibilities);
  }

  run() {
    return this._doNextCombo();
  }

  _doNextCombo() {
    ++this._currentIteration;
    const values = this._iterator.next();
    if (values === null || this._currentIteration > this.totalCases) {
      return;
    }
    const paramsHash = paramsHashFromValues(values);

    const start = process.hrtime();
    return scenario(paramsHash).then(data => {
      const time = nsSinceHrtime(start);
      this._onResult(time, data, values, this._currentIteration);
      return this._doNextCombo();
    });
  }
}

function nsSinceHrtime(hrtimeStart) {
  const diff = process.hrtime(hrtimeStart);
  return diff[0] * 1e9 + diff[1];
}


function paramsHashFromValues(values) {
  const paramsHash = {};
  values.forEach((v, i) => {
    paramsHash[keys[i]] = v;
  });
  return paramsHash;
}
