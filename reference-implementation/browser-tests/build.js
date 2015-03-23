const browserify = require('browserify');
const es6ify = require('es6ify');
const glob = require('glob');
const path = require('path');
const fs = require('fs');

es6ify.traceurOverrides = {
  // Settings based on Chrome 42
  blockBinding: 'parse',
  forOf: 'parse',
  generators: 'parse',
  numericLiterals: 'parse',
  symbols: false,
  templateLiterals: 'parse',
  classes: 'parse',
  computedPropertyNames: 'parse',
  propertyMethods: 'parse',
  propertyNameShorthand: 'parse'
};


const tests = glob.sync(path.resolve(__dirname, '../test/*.js'));

const browserifyInstance = browserify({ debug: true })
  .add(es6ify.runtime)
  .add(path.resolve(__dirname, 'setup.js'))
  .transform(es6ify);
tests.forEach(t => browserifyInstance.add(t));

const dest = fs.createWriteStream(path.resolve(__dirname, 'bundle.js'));
browserifyInstance.bundle().pipe(dest);
