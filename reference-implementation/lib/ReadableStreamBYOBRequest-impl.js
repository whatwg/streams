'use strict';
const assert = require('assert');

const { CanTransferArrayBuffer } = require('./abstract-ops/ecmascript.js');
const aos = require('./abstract-ops/readable-streams.js');

exports.implementation = class ReadableStreamBYOBRequestImpl {
  get view() {
    return this._view;
  }

  respond(bytesWritten) {
    if (this._controller === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    if (CanTransferArrayBuffer(this._view.buffer) === false) {
      throw new TypeError('The BYOB request\'s buffer has been detached and so cannot be used as a response');
    }

    assert(this._view.byteLength > 0);
    assert(this._view.buffer.byteLength > 0);

    aos.ReadableByteStreamControllerRespond(this._controller, bytesWritten);
  }

  respondWithNewView(view) {
    if (this._controller === undefined) {
      throw new TypeError('This BYOB request has been invalidated');
    }

    if (CanTransferArrayBuffer(view.buffer) === false) {
      throw new TypeError('The given view\'s buffer is not transferable and so cannot be used as a response');
    }

    aos.ReadableByteStreamControllerRespondWithNewView(this._controller, view);
  }
};
