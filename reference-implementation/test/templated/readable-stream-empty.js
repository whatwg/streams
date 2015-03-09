const tapeTest = require('tape-catch');

export default (label, factory) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('instances have the correct methods and properties', t => {
    const rs = factory();

    t.ok(rs.closed, 'has a closed property');
    t.equal(typeof rs.closed.then, 'function', 'closed property is thenable');

    t.equal(typeof rs.cancel, 'function', 'has a cancel method');
    t.equal(typeof rs.getReader, 'function', 'has a getReader method');
    t.equal(typeof rs.pipeThrough, 'function', 'has a pipeThrough method');
    t.equal(typeof rs.pipeTo, 'function', 'has a pipeTo method');

    t.end();
  });
};
