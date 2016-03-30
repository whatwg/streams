'use strict';
const fs = require('fs');
const childProcess = require('child_process');
const promiseDebounce = require('promise-debounce');
const emuAlgify = require('emu-algify');

const build = promiseDebounce(() => {
  log('Building...');

  try {
    childProcess.execSync(
      'bikeshed spec index.bs index.html --md-Text-Macro="SNAPSHOT-LINK <local watch copy>"',
      { encoding: 'utf-8', stdio: 'inherit' }
    );
    log('(bikeshed done)');
  } catch (e) {
    error('Error executing bikeshed:\n');
    console.error(e.stdout);
  }

  const input = fs.readFileSync('index.html', { encoding: 'utf-8' });

  return emuAlgify(input, { throwingIndicators: true })
    .then(output => {
      fs.writeFileSync('index.html', output);
      log('Build complete');
    })
    .catch(err => {
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
