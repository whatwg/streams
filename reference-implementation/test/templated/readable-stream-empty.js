const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('instances have the correct methods and properties', t => {
    const rs = factory();

    t.equal(typeof rs.cancel, 'function', 'has a cancel method');
    t.equal(typeof rs.getReader, 'function', 'has a getReader method');
    t.equal(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');
    t.equal(typeof rs.pipeTo, 'function', 'has a pipeTo method');
    t.equal(typeof rs.tee, 'function', 'has a tee method');

    t.end();
  });
};
