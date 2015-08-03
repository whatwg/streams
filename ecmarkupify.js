// Usage: traceur-runner ecmarkupify.js input.html output.html

const fs = require('fs');
const jsdom = require('jsdom');
const EmuSpec = require('ecmarkup/lib/Spec');


export default ecmarkupify;

// Can't use usual trick of module.parent === null because we intend to be run via traceur-runner
if (module.parent == require.main) {
  ecmarkupify(process.argv[2], process.argv[3]).catch(e => setTimeout(() => { throw e; }, 0));
}


function ecmarkupify(inputFile, outputFile) {
  const inputText = fs.readFileSync(inputFile, { encoding: 'utf-8' });
  const doc = jsdom.jsdom(inputText);

  const spec = new EmuSpec(inputFile, fetch, doc);

  return Promise.all([
    spec.loadES6Biblio(),
    spec.loadBiblios()
  ])
  .then(() => {
    addAllAOIDsToBiblio(spec);
    addThrowingTags(spec.doc);
    spec.buildAlgs();

    fs.writeFileSync(outputFile, jsdom.serializeDocument(spec.doc));
  });
}

function fetch(path) {
  return new Promise((resolve, reject) => {
    fs.readFile(path, { encoding: 'utf-8' }, (err, contents) => {
      if (err) {
        reject(err);
      }
      resolve(contents);
    });
  });
}

function addAllAOIDsToBiblio(spec) {
  // Allow aoid="" anywhere. Ecmarkup's default configuration only scans for them when building, and even then only on
  // <emu-clause> and <emu-alg>.

  const aos = Array.from(spec.doc.querySelectorAll('[aoid]'));
  for (const ao of aos) {
    const aoid = ao.getAttribute('aoid');
    spec.biblio.ops[aoid] = '#' + ao.id;
  }
}

function addThrowingTags(doc) {
  const aos = Array.from(doc.querySelectorAll('[aoid]'));
  for (const ao of aos) {
    const hasThrows = ao.hasAttribute('throws');
    const hasNothrow = ao.hasAttribute('nothrow');

    if ((!hasThrows && !hasNothrow) || (hasThrows && hasNothrow)) {
      throw new Error('All abstract operations must be notated with exactly one of the throws or nothrow ' +
        `attributes. Check the abstract operation with aoid="${ao.getAttribute("aoid")}"`);
    }

    const labelEl = doc.createElement('span');
    labelEl.className = 'annotation';
    labelEl.textContent = hasThrows ? 'throws' : 'nothrow';
    labelEl.title = hasThrows ? 'can return an abrupt completion' : 'never returns an abrupt completion';

    const insertBeforeThis = ao.querySelector('.self-link');
    ao.insertBefore(labelEl, insertBeforeThis);
    ao.insertBefore(doc.createTextNode(' '), labelEl);
  }
}
