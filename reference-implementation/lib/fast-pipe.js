'use strict';

// Note: Readable streams and writable streams that are capable of fast piping
// doesn't use strategy in JS.

class GlobalPipeManager {
  constructor() {
    // Describes all the ongoing pipes including non-skipping pipeTo().
    this._pipeRequests = {};

    this._pipes = [];
  }

  onPipeProgress(pipe) {
    for (let req of pipe.coveredRequests) {
      req.onProgress(numBytesDone);
    }

    reorganizeIfNeeded();
  }

  registerRequest(req) {
    this._pipeRequests[req] = true;

    reorganizeIfNeeded();
  }

  unregisterRequest(req) {
    delete this._pipeRequests[req];
  }

  reorganizeIfNeeded() {
    // Calculate the best combinations, so that
    // - All requests in _pipeRequests are covered.
    // - There's no overlap of covered requests between pipes in _pipes.

    // Stop pipes if needed.
    // Create pipes if needed.
  }
}

GlobalPipeManager.PROGRESS = 0;
GlobalPipeManager.REQUESTS_UPDATE = 1;

const globalPipeManager = new GlobalPipeManager();

class Pipe {
  constructor(readable, writable, coveredRequests) {
    this._coveredRequests = coveredRequests;
    for (let req of coveredRequests) {
      req.coveredBy(this);
    }

    doSpecialPipe(readable, writable);
  }

  get coveredRequests() {
    return this._coveredRequests;
  }

  onProgress(numBytesDone) {
    globalPipeManager.onPipeProgress(this, numBytesDone);
  }

  stop() {
    // Stop the special pipe for reorganize. Returns a promise which fulfills
    // when stopping is complete.
  }

  abort() {
    // Abort
  }
}

// Corresponds to and describes each pipeTo() invocation.
class PipeRequest {
  constructor(reader, writer, numBytes) {
    this._remainingBytes = numBytes;

    // The reader of the source readable stream from which we pipe data.
    this._reader = reader;
    // The writer of the destination writable stream to which we pipe data.
    this._writer = writer;

    // The active pipe instance which is covering this request.
    this._pipe = undefined;

    this._done = false;

    globalPipeManager.register(this);

    function processPipeCandidates() {
      if (this._done === true) {
        return;
      }

      const candidates = this._writer.pipeCandidates;

      this._pipeCandidates = [];
      for (let candidate of candidates) {
        this._pipeCandidates.push(candidate);
      }
      globalPipeManager.onRequestsUpdate(this);

      // Notify readable of candidates of pipe destinations. The underlying
      // source of readable may forward the candidates to a writable stream and
      // have the writable stream return the candidates via pipeCandidates
      // property. The most common case is the identity transform stream.
      // The identity transform stream (possibly after dealing with queued
      // chunks somehow) forwards pipe candidates to allow a readable stream
      // which is being piped to the writable side of the transform stream
      // to directly pipe to one of the candidates by skipping the transform
      // stream.
      //
      // pipeCandidates might be updated asynchronously.
      // GlobalPipeManager.onRequestsUpdate() may need to adopt some
      // intelligent algorithm to avoid churn.
      //
      // flushRequired is a list of writable streams indicating that the
      // candidates are not yet available but becomes available if writes to
      // the writable streams are throttled to allow their parent transform
      // stream to flush data. E.g. an IdentityTransformStream with pending
      // queue inside it could append its writable stream to flushRequired to
      // ask the global pipe manager to suspend piping to the writable stream
      // for a while to enable the pipe candidates.
      const candidatesToForward = {
        flushRequired: [],
        pipeRequest: this
      };
      for (let candidate of candidates) {
        candidatesToForward.push(candidate);
      }
      this._reader.notifyPipeCandidates(candidatesToForward);

      this._writer.waitPipeCandidatesChange.then(() => {
        processPipeCandidates();
      })
    }
    processPipeCandidates();
  }

  // To be scanned by the global pipe manager and the best one will be chosen
  // from them.
  pipeCandidates() {
    return this._candidates;
  }

  // Synchronous. It might be inaccurate if there's asynchronous transfer
  // ongoing in background. To be used by the global pipe manager as a hint.
  remainingBytes() {
    return this._remainingBytes;
  }

  coveredBy(pipe) {
    assert(this._pipe === undefined);
    this._pipe = pipe;
  }

  onProgress(numBytesDone) {
    this._remainingBytes -= numBytesDone;

    if (this._remainingBytes() > 0) {
      return;
    }

    this._done = true;
    this._readable.notifyPipeCandidate([]);

    globalPipeManager.unregisterRequest(this);

    // Finish piping by updating states considering preventClose, preventAbort
    // and preventCancel.
    this.finishPipe();
  }

  abort() {
    this._pipe.abort();
  }
}
