# Transferring Ownership Streams Explained


## Introduction

The streams APIs provide a convenient way to build processing pipelines.
Using streams with `VideoFrame` objects has known shortcomings, as illustrated by https://github.com/whatwg/streams/issues/1155 or https://github.com/whatwg/streams/issues/1185 for instance.
This proposal addresses these shortcomings by improving streams support for chunks similar but not limited to WebCodec `VideoFrame`.
It could also be useful for streams making use of `ArrayBuffer` or chunks that own `ArrayBuffer` like `RTCEncodedVideoChunk`.

Streams APIs can create coupling between the processing units of the pipeline when chunks in the pipe are mutable:
a processing unit A might pass a chunk O to another unit B through a stream (say a `WritableStream`) W.
If A keeps a reference to O, it might mutate O while B is doing processing based on O.

This is especially an issue with chunks like `VideoFrame` objects that need to be closed explicitly.
Taking the previous example, if A decides to close a `VideoFrame` after passing it to W but before B gets it, B will receive a closed `VideoFrame`, which is probably considered a bug.
If A does not close `VideoFrame`, it is the responsibility of the remaining of the pipeline to close it.
There is a need to clearly identify who is owning these chunks and who is responsible to close these chunks at any point in time.

The proposed solution is to transfer ownership of a chunk to the stream when it gets written or enqueueud to the stream.
By doing so, the processing unit that enqueues/writes chunks will not be able to mutate chunks manipulated by the stream and is relieved of the lifetime management of these chunks.
Conversely, processing units take ownership of chunks when they receive them from a stream.

Transferring ownership should be opt-in. For that purpose, a new streams type, named 'transfer' in this document,  would be added.

## Example

Below is an example of JavaScript that shows how this can be used.
The example creates a processing pipe starting with a VideoFrame stream and applying two transforms, one for doing a processing like logging every 30 frame, and one for doing background blur.

```worker.js javascript
function doBackgroundBlurOnVideoFrames(videoFrameStream, doLogging)
{
  // JavaScript custom transform.
  let frameCount = 0;
  const frameCountTransform = new TransformStream({
    transform: async (videoFrame, controller) => {
      try {
        // videoFrame is under the responsibility of the script and must be closed when no longer needed.
        controller.enqueue(videoFrame);
        // controller.enqueue was called, videoFrame is transferred.
        if (!(++frameCount % 30) && doLogging)
            doLogging(frameCount);
      } catch (e) {
        // In case of exception, let's make sure videoFrame is closed. This is a no-op if videoFrame was previously transferred.
        videoFrame.close();
        // If exception is unrecoverable, let's error the pipe.
        controller.error(e);
      }
    },
    readableType: 'transfer',
    writableType: 'transfer'
  });
  // Native transform is of type 'transfer'
  const backgroundBlurTransform = new BackgroundBlurTransform();

  return videoFrameStream.pipeThrough(backgroundBlurTransform)
                         .pipeThrough(frameCountTransform);
}
```

## Goals

*   Permit `ReadableStream`, `WritableStream` and `TransformStream` objects to take ownership of chunks they manipulate.
*   Permit to build a safe and optimal video pipeline using `ReadableStream`, `WritableStream` and `TransformStream` objects that manipulate `VideoFrame` objects.
*   Permit both native and JavaScript-based streams of type 'transfer'.
*   Permit to optimize streams pipelines of transferable chunks like `ArrayBuffer`, `RTCEncodedVideoFrame` or `RTCEncodedAudioFrame`.
*   Permit to tee a `ReadableStream` of `VideoFrame` objects without tight coupling between the teed branches.

## Non-goals

*   Add support for transferring and closing of arbitrary JavaScript chunks.

## Use cases

*   Performing realtime transformations of `VideoFrame` objects, for instance taking a camera `MediaStreamTrack` and applying
    a background blur effect as a `TransformStream` on each `VideoFrame` of the `MediaStreamTrack`.

## End-user benefit

*   `VideoFrame` needs specific management and be closed as quickly as possible, without relying on garbage collection.
    This is important to not create hangs/stutters in the processing pipeline. By building support for safe patterns
    directly in streams, this will allow web developers to optimize `VideoFrame` management, and allow user experience
    to be more consistent accross devices.

## Principles

The envisioned changes to the streams specification could look like the following:
*   Add a new 'transfer' value that can be passed to `ReadableStream` type, `WritableStream` type and `TransformStream` readableType/writableType.
    For streams that do not use the 'transfer' type, nothing changes.
*   Streams of the 'transfer' type can only manipulate chunks that are marked both as Transferable and Serializable.
*   If a chunk that is either not Transferable or not Serializable is enqueued or written, the chunk is ignored as if it was never enqueued/written.
*   If a Transferable and Serializable chunk is enqueueud/written in a 'transfer' type `ReadableStreamDefaultController`, `TransformStreamDefaultController`
    or `WritableStreamDefaultWriter`, create a transferred version of the chunk using StructuredSerializeWithTransfer/StructuredDeserializeWithTransfer.
    Proceed with the regular stream algorithm by using the transferred chunk instead of the chunk itself.
*   Introduce a WhatWG streams 'close-able' concept. A chunk that is 'close-able' defines closing steps.
    For instance `VideoFrame` closing steps could be defined using https://www.w3.org/TR/webcodecs/#close-videoframe.
    `ArrayBuffer` closing steps could be defined using https://tc39.es/ecma262/#sec-detacharraybuffer.
    The 'close-able' steps should be a no-op on a transferred chunk.
*   Execute the closing steps of a 'close-able' chunk for streams with the 'transfer' type when resetting the queue of `ReadableStreamDefaultController`
    or emptying `WritableStream`.[[writeRequests]] in case of abort/error.
*   When calling tee() on a `ReadableStream` of the 'transfer' type, call ReadableStream with cloneForBranch2 equal to true. 
*   To solve https://github.com/whatwg/streams/issues/1186, tee() on a `ReadableStream` of the 'transfer' type can take a 'realtime' parameter.
    When the 'realtime' parameter is used, chunks will be dropped on the branch that consumes more slowly to keep buffering limited to one chunk.
    The closing steps should be called for any chunk that gets dropped in that situation.

## Alternatives

*   It is difficult to emulate neutering/closing of chunks especially in case of teeing or aborting a stream.
*   As discussed in https://github.com/whatwg/streams/issues/1155, lifetime management of chunks could potentially be done at the source level.
    But this is difficult to make it work without introducing tight coupling between producers and consumers.
*   The main alternative would be to design a VideoFrame specific API outside of WhatWG streams, which is feasible, as examplified by WebCodecs API.

## Future Work

*   Evaluate what to do when enqueuing/writing a chunk that is not Transferable or not Serializable. We might want to reject the related promise without erroring the stream.
*   Evaluate the usefulness of supporting Serializable but not Transferable chunks, we might just need to create a copy through serialization steps then explicitly call closeable steps on the chunk.
*   Evaluate the usefulness of supporting Transferable but not Serializable chunks, in particular in how to handle `ReadableStream` tee().
    If `ReadableStream` tee() exposes a parameter to enable structured cloning, it might sometimes fail with such chunks and we could piggy back on this behavior.
*   Evaluate the usefulness of adding a `TransformStream` type to set readableType and writableType to the same value.
*   Envision extending this support for arbitrary JavaScript chunks, for both transferring and explicit closing.
*   Envision to introduce close-able concept in WebIDL.
*   We might want to mention that, if we use detach steps for `ArrayBuffer`, implementations can directly deallocate the corresponding memory.
