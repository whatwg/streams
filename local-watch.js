'use strict';
const fs = require('fs');
const childProcess = require('child_process');
const promiseDebounce = require('promise-debounce');
const emuAlgify = require('emu-algify');

const INPUT = 'index.bs';

let fsWatcher;

const build = promiseDebounce(() => {
  log('Building...');

  try {
    childProcess.execSync(
      `bikeshed spec ${INPUT} index.html.postbs --md-Text-Macro="SNAPSHOT-LINK <local watch copy>"`,
      { encoding: 'utf-8', stdio: 'inherit' }
    );
    log('(bikeshed done)');
  } catch (e) {
    error('Error executing bikeshed:\n');
    console.error(e.stdout);
  }

  const input = fs.readFileSync('index.html.postbs', { encoding: 'utf-8' });
  fs.unlinkSync('index.html.postbs');

  return emuAlgify(input, { throwingIndicators: true })
    .then(output => {
      fs.writeFileSync('index.html.new', output);
      fs.renameSync('index.html.new', 'index.html');
      log('Build complete');
    })
    .catch(err => {
      error('Error executing ecmarkupify:\n');
      console.error(err);
    }
  );
});

function onChange(eventType, filename) {
  log(`Saw ${eventType} event with filename '${filename}'`);
  // Restart the watch in case the file has been renamed or deleted. This fixes an issue where the file stopped being
  // watched when a different branch was checked out.
  tryWatch();
}

// If index.bs exists, start watching it and run a build. Otherwise retry with a truncated exponential delay until it
// starts to exist.
function tryWatch(delay) {
  if (fsWatcher !== undefined) {
    fsWatcher.close();
    fsWatcher = undefined;
  }
  try {
    fsWatcher = fs.watch(INPUT, onChange);
    build();
  } catch (e) {
    if (e.code === 'ENOENT') {
      log(`${INPUT} not there right now. Waiting a bit.`);
      if (delay === undefined) {
        delay = 100;
      }
      delay *= 2;
      if (delay > 20000) {
        delay = 20000;
      }
      setTimeout(tryWatch, delay, delay);
    } else {
      throw e;
    }
  }
}

tryWatch();

function log(s) {
  console.log(`[${(new Date()).toISOString()}] ${s}`);
}

function error(s) {
  console.error(`[${(new Date()).toISOString()}] ${s}`);
}
