'use strict';
var traceur = require('traceur');
var glob = require('glob');
var path = require('path');

traceur.require.makeDefault(function (filename) {
  // Don't compile our dependencies.
  return filename.indexOf('node_modules') === -1;
});

if (process.argv[2]) {
    require(path.resolve(process.argv[2]));
} else {
    glob.sync(path.resolve(__dirname, 'test/*.js')).forEach(require);
}
