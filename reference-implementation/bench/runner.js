var sandwich = require('sandwich');
var util = require('util');
var ms = require('ms');

module params from './params';
import scenario from './pipe-chain';

var possibilities = params.quickTestPossibilities;
var combinationsIterator = sandwich(...params.keys.map(k => possibilities[k]));

console.log(`About to run ${combinationsIterator.possibilities} tests`);

var start = Date.now();
doNextCombo()
  .then(() => console.log(`Total time elapsed: ${ms(Date.now() - start, { long: true })}`))
  .catch(console.error);

var currentComboIndex = 0;
function doNextCombo() {
  var comboValues = combinationsIterator.next();
  if (comboValues === null) {
    return;
  }
  var comboParams = comboParamsFromComboValues(comboValues);

  var start = process.hrtime();
  return scenario(comboParams).then(results => {
    var milliseconds = msSinceHrtime(start);
    var displayValues = JSON.stringify(comboValues);
    console.log(`(${++currentComboIndex}/1024) ${displayValues}: ${milliseconds} ms, ${util.format(results)}`);

    return doNextCombo();
  });
}

function comboParamsFromComboValues(comboValues) {
  var comboParams = {};
  comboValues.forEach((v, i) => {
    comboParams[params.keys[i]] = v;
  });
  return comboParams;
}

function msSinceHrtime(hrtimeStart) {
  var diff = process.hrtime(hrtimeStart);
  var nanoseconds = diff[0] * 1e9 + diff[1];
  return nanoseconds / 1e6;
}
