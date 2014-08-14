var fs = require('fs');
var path = require('path');
var util = require('util');
var textTable = require('text-table');

var resultsDir = path.resolve(__dirname, 'results');
var resultsFiles = fs.readdirSync(resultsDir).sort();
var lastFewFiles = resultsFiles.slice(-4).reverse();
var lastFewResults = lastFewFiles.map(file => {
  var filename = path.resolve(__dirname, 'results', file);
  var contents = fs.readFileSync(filename, { encoding: "utf-8" });
  return JSON.parse(contents)
});

var TIME_EPSILON = 15e6; // 15 milliseconds
var PAUSES_EPSILON = 1;

for (var i = lastFewFiles.length - 1; i > 0; --i) {
  printComparison(i);
  console.log('\n');
}

function printComparison(otherIndex) {
  var title = `${lastFewFiles[0]} (current) vs. ${lastFewFiles[otherIndex]} (current - ${otherIndex})`;
  console.log(`${title}\n${'-'.repeat(title.length)}`);
  console.log(comparisonTable(lastFewResults[0], lastFewResults[otherIndex]));
}

function comparisonTable(reference, other) {
  var filteredDelta = filterDelta(getDelta(reference, other));

  var table = Object.keys(filteredDelta).map(k => {
    var values = JSON.parse(k);
    var { time, pauses } = filteredDelta[k];
    [time, pauses] = [addSign(time / 1e6), addSign(pauses)];

    return [values, time, pauses];
  });

  return textTable(table) || '(No difference within the epsilon)';
}

function getDelta(reference, other) {
  var delta = {};
  Object.keys(reference).forEach(k => {
    delta[k] = {
      time: reference[k].time - other[k].time,
      pauses: reference[k].data.pauses - other[k].data.pauses
    };
  });
  return delta;
}

function filterDelta(delta) {
  var filteredDelta = {};
  Object.keys(delta).forEach(k => {
    var { time, pauses } = delta[k];
    if (Math.abs(time) > TIME_EPSILON || Math.abs(pauses) > PAUSES_EPSILON) {
      filteredDelta[k] = { time, pauses };
    }
  });
  return filteredDelta;
}

function addSign(x) {
  return x > 0 ? ('+' + x) : x;
}
