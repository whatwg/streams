const fs = require('fs');
const path = require('path');
const util = require('util');
const textTable = require('text-table');

const resultsDir = path.resolve(__dirname, 'results');
const resultsFiles = fs.readdirSync(resultsDir).sort();
const lastFewFiles = resultsFiles.slice(-4).reverse();
const lastFewResults = lastFewFiles.map(file => {
  const filename = path.resolve(__dirname, 'results', file);
  const contents = fs.readFileSync(filename, { encoding: "utf-8" });
  return JSON.parse(contents)
});

const TIME_EPSILON = 15e6; // 15 milliseconds
const PAUSES_EPSILON = 1;

for (let i = lastFewFiles.length - 1; i > 0; --i) {
  printComparison(i);
  console.log('\n');
}

function printComparison(otherIndex) {
  const title = `${lastFewFiles[0]} (current) vs. ${lastFewFiles[otherIndex]} (current - ${otherIndex})`;
  console.log(`${title}\n${'-'.repeat(title.length)}`);
  console.log(comparisonTable(lastFewResults[0], lastFewResults[otherIndex]));
}

function comparisonTable(reference, other) {
  const filteredDelta = filterDelta(getDelta(reference, other));

  const table = Object.keys(filteredDelta).map(k => {
    const values = JSON.parse(k);
    const { time, pauses } = filteredDelta[k];
    [time, pauses] = [addSign(time / 1e6), addSign(pauses)];

    return [values, time, pauses];
  });

  return textTable(table) || '(No difference within the epsilon)';
}

function getDelta(reference, other) {
  const delta = {};
  Object.keys(reference).forEach(k => {
    delta[k] = {
      time: reference[k].time - other[k].time,
      pauses: reference[k].data.pauses - other[k].data.pauses
    };
  });
  return delta;
}

function filterDelta(delta) {
  const filteredDelta = {};
  Object.keys(delta).forEach(k => {
    const { time, pauses } = delta[k];
    if (Math.abs(time) > TIME_EPSILON || Math.abs(pauses) > PAUSES_EPSILON) {
      filteredDelta[k] = { time, pauses };
    }
  });
  return filteredDelta;
}

function addSign(x) {
  return x > 0 ? ('+' + x) : x;
}
