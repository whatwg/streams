'use strict';

// http://stackoverflow.com/questions/1349404/generate-a-string-of-5-random-characters-in-javascript
function randomChunk(size) {
  var text = "";
  var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  for (var i = 0; i < size; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function RandomPushSource(toPush) {
  this.pushed  = 0;
  this.toPush  = toPush;
  this.started = false;
  this.paused  = false;
  this.closed  = false;
  this._handle = null;
}

RandomPushSource.prototype.readStart = function readStart() {
  if (this.closed) return;

  var stream = this;

  function writeChunk() {
    if (stream.paused) return;

    stream.pushed++;

    if (stream.toPush > 0 && stream.pushed > stream.toPush) {
      if (stream._handle) {
        clearInterval(stream._handle);
        stream._handle = undefined;
      }
      stream.closed = true;
      stream.onend();
    }
    else {
      stream.ondata(randomChunk(128));
    }
  }

  if (!this.started) {
    this._handle = setInterval(writeChunk, 23);
    this.started = true;
  }

  if (this.paused) {
    this._handle = setInterval(writeChunk, 23);
    this.paused = false;
  }
};

RandomPushSource.prototype.readStop = function readStop() {
  if (this.paused) return;

  if (this.started) {
    this.paused = true;
    clearInterval(this._handle);
    this._handle = undefined;
  }
  else {
    throw new Error('can\'t pause reading an unstarted stream');
  }
};

RandomPushSource.prototype.onend   = function onend() { };
RandomPushSource.prototype.ondata  = function ondata() {};
RandomPushSource.prototype.onerror = function onerror() {};

module.exports = RandomPushSource;
