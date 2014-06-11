'use strict';

// TODO: an evolved form of this should be part of the standard library. Although before that happens it needs to
// handle aborts/cancels/errors correctly.

module.exports = function makeSimpleTransformStream() {
  var pushToOutput;
  var closeOutput;

  return {
    input : new BaseWritableStream({
      write : function (data, done, error) {
        pushToOutput(data);
        done();
      },

      close : function () {
        closeOutput();
      }
    }),

    output : new ReadableStream({
      start : function (push, close) {
        pushToOutput = push;
        closeOutput = close;
      }
    })
  };
};
