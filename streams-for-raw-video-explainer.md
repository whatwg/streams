# Transfering Ownership Streams Explained


## Introduction

The streams APIs provide a convenient way to build processing pipelines.
Using streams with `VideoFrame` objects has known shortcomings, as illustrated by https://github.com/whatwg/streams/issues/1155 or https://github.com/whatwg/streams/issues/1185 for instance.
This proposal addresses these shortcomings by improving streams support for objects similar but not limited to WebCodec `VideoFrame`.
It could also be useful for streams making use of `ArrayBuffer` or objects that own `ArrayBuffer` like `RTCEncodedVideoChunk`.

Streams APIs can create coupling between the processing units of the pipeline when objects in the pipe are mutable:
a processing unit A might pass an object O to another unit B through a stream (say a `WritableStream`) W.
If A keeps a reference to O, it might mutate O while B is doing processing based on O.

This is especially an issue with objects like `VideoFrame` objects that need to be closed explicitly.
Taking the previous example, if A decides to close a `VideoFrame` after passing it to W but before B gets it, B will receive a closed `VideoFrame`, which is probably considered a bug.
If A does not close `VideoFrame`, it is the responsibility of the remaining of the pipeline to close it.
There is a need to clearly identify who is owning these objects and who is responsible to close these objects at any point in time.

The proposed solution is to transfer ownership of an object to the stream when it gets written or enqueueud to the stream.
By doing so, the processing unit that enqueues/writes objects will not be able to mutate objects manipulated by the stream and is relieved of the lifetime management of these objects.
Conversely, processing units take ownership of objects when they receive them from a stream.

Transferring ownership should be opt-in. For that purpose, a new streams type, named 'transfer' in this document,  would be added.

## Example

Below is an example of JavaScript that shows how this can be used.
The example creates a processing pipe starting with a camera stream and applying two transforms, one for doing a processing for every 30 frame, and one for doing background blur.

```javascript
// JS transform
const frameCountTransform = new TransformStream({
  transform: async (videoFrame, controller) => {
    try {
      // videoFrame is under the responsibility of the script and must be closed when no longer needed
      controller.enqueue(videoFrame);
      // At this point, videoFrame has been transfered within controller.enqueue call. frameCountTransform cannot mutate it.
      if (!controller.count)
        controller.count = 0;
      if (!(++controller.count % 30) && frameCountTransform.onEach30Frame)
          frameCountTransform.onEach30Frame(controller.count);
    } catch {
      videoFrame.close();
    }
  },
  type: 'transfer'
});
frameCountTransform.onEach30Frame = (count) => {
  // Do something periodically.
};
// Native transform is of type 'transfer'
const backgroundBlurTransform = new BackgroundBlurTransform();

const cameraStream = await navigator.mediaDevices.getUserMedia({ video : true });
const videoFrameStream = getReadableStreamFromTrack(cameraStream.getVideoTracks()[0]);
const blurredVideoFrameStream = videoFrameStream.pipeThrough(backgroundBlurTransform)
                                                .pipeThrough(frameCountTransform);
const blurredStream = new MediaStream([getTrackFromReadableStream(blurredVideoFrameStream)]);
// Make use of blurredStream.
...
```

## Goals

*   Permit `ReadableStream`, `WritableStream` and `TransformStream` objects to take ownership of objects they manipulate.
*   Permit to build a safe and optimal video pipeline using `ReadableStream`, `WritableStream` and `TransformStream` objects that manipulate `VideoFrame` objects.
*   Permit both native and JavaScript-based streams of type 'transfer'.
*   Permit to optimize streams pipelines of transferable objects like `ArrayBuffer`, `RTCEncodedVideoFrame` or `RTCEncodedAudioFrame`.
*   Permit to tee a `ReadableStream` of `VideoFrame` objects without tight coupling between the teed branches.

## Non-goals

*   Add support for supporting transfer and closing of arbitrary JavaScript objects.

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
*   Add a new 'transfer' type to `ReadableStream`, `WritableStream` and `TransformStream`.
    For streams that do not have the 'transfer' type, nothing changes.
*   Streams of the 'transfer' type can only manipulate Transferable or Serializable objects.
    If a non Transferable or Serializable object is enqueued or written, the object is ignored as if it was never enqueued/written.
*   If a Transferable object is enqueueud/written in a 'transfer' type `ReadableStreamDefaultController`, `TransformStreamDefaultController`
    or `WritableStreamDefaultWriter`, create a copy of the object using StructuredSerializeWithTransfer/StructuredDeserializeWithTransfer.
    Proceed with the regular stream algorithm by using the copy of the object instead of the object itself.
*   If a Serializable object is enqueueud/written in a 'transfer' type `ReadableStreamDefaultController`, `TransformStreamDefaultController`
    or `WritableStreamDefaultWriter`, create a copy of the object using StructuredSerialize/StructuredDeserialize.
    Proceed with the regular stream algorithm by using the copy of the object instead of the object itself.
*   Introduce a WhatWG streams 'close-able' concept. An object that is 'close-able' defines closing steps.
    For instance `VideoFrame` closing steps could be defined using https://www.w3.org/TR/webcodecs/#close-videoframe.
    `ArrayBuffer` closing steps could be defined using https://tc39.es/ecma262/#sec-detacharraybuffer.
*   Execute the closing steps of a 'close-able' object for streams with the 'transfer' type when resetting the queue of `ReadableStreamDefaultController`
    or emptying `WritableStream`.[[writeRequests]] in case of abort/error.
*   When calling tee() on a `ReadableStream` of the 'transfer' type, call ReadableStream with cloneForBranch2 equal to true. 
*   To solve https://github.com/whatwg/streams/issues/1186, tee() on a `ReadableStream` of the 'transfer' type can take a 'realtime' parameter.
    When the 'realtime' parameter is used, chunks will be dropped on the branch that consumes more slowly to keep buffering limited to one chunk.
    The closing steps should be called for any chunk that gets dropped in that situation.

## Alternatives

*   It is difficult to emulate neutering/closing of objects especially in case of teeing or aborting a stream.
*   As discussed in https://github.com/whatwg/streams/issues/1155, lifetime management of objects could potentially be done at the source level.
    But this is difficult to make it work without introducing tight coupling between producers and consumers.

## Future Work

*   Envision extending this support for arbitrary JavaScript objects, for both transferring and explicit closing.
*   Envision to introduce close-able concept in WebIDL.
