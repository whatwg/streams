'use strict';

require('./index.js');
var Promise = require('es6-promise').Promise;

// TODO: handle errors.
var pushToOutput;
var closeOutput;
var passThroughTransform = {
  input: new BaseWritableStream({
    write: function (data, done, error) {
      console.log('writing to the input side', data);
      pushToOutput(data);
      console.log('passThroughTransform.input.state', passThroughTransform.input.state);
      done();
    },

    close: function () {
      closeOutput();
    }
  }),

  output: new BaseReadableStream({
    start: function (push, close) {
      pushToOutput = push;
      closeOutput = close;
    }
  })
};

var makeSequentialBRS = require('./test/lib/sequential-brs');
var readableStreamToArray = require('./test/lib/readable-stream-to-array');

var rs = new BaseReadableStream({
  start: function (push, close) {
//    console.log(push('hi'));
    Promise.resolve().then(function () {
      console.log('---');
//      console.log('rs.state', rs.state);
      console.log(push('hey'));
//      console.log('rs.state', rs.state);
      console.log(push('what'));
//      console.log('rs.state', rs.state);
      console.log(push('whee'));
//      console.log('rs.state', rs.state);
      console.log('---');
      close();
    });
  },
});

console.log('passThroughTransform.input.state', passThroughTransform.input.state);
var output = rs.pipeThrough(passThroughTransform);

readableStreamToArray(output).then(function (chunks) {
  console.log('chunks', chunks);
});
