'use strict';
var traceur = require('traceur');
var glob = require('glob');
var path = require('path');

require('traceur-source-maps').install(traceur);

traceur.require.makeDefault(function (filename) {
  // Don't compile our dependencies.
  return filename.indexOf('node_modules') === -1;
});

process.argv.slice(2).forEach(function (filename) {
    glob.sync(path.resolve(__dirname, filename)).forEach(require);
});
