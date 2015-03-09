const tapeTest = require('tape-catch');

export default (label, factory, error) => {
  function test(description, testFn) {
    tapeTest(`${label}: ${description}`, testFn);
  }

  test('closed should reject with the error', t => {
    t.plan(1);
    const rs = factory();

    rs.closed.then(
      () => t.fail('closed should not fulfill'),
      r => t.equal(r, error, 'closed should reject with the error')
    );
  });
};
