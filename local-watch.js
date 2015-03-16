const fs = require('fs');
const childProcess = require('child_process');
const promiseDebounce = require('promise-debounce');
import ecmarkupify from './ecmarkupify.js';

const build = promiseDebounce(() => {
  log('Building...');

  try {
    childProcess.execSync(
      'bikeshed spec index.bs index.html --md-Text-Macro="SNAPSHOT-LINK <local watch copy>"',
      { encoding: 'utf-8' }
    );
    log('(bikeshed done)');
  } catch (e) {
    error('Error executing bikeshed:\n');
    console.error(e.stdout);
  }

  return ecmarkupify('index.html', 'index.html').then(
    () => log('Build complete'),
    err => {
      error('Error executing ecmarkupify:\n');
      console.error(err);
    }
  );
});

fs.watch('index.bs', build);
build();

function log(s) {
  console.log(`[${(new Date()).toISOString()}] ${s}`);
}

function error(s) {
  console.error(`[${(new Date()).toISOString()}] ${s}`);
}
