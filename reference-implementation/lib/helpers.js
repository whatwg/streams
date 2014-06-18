'use strict';

var assert = require('assert');
var Promise = require('es6-promise').Promise;

exports.promiseCall = function (func) {
    var args = Array.prototype.slice.call(arguments, 1);

    try {
        return Promise.cast(func.apply(undefined, args));
    } catch (e) {
        return Promise.reject(e);
    }
};

exports.enqueueValueWithSize = function (queue, value, size) {
    size = Number(size);
    if (isNaN(size)) {
        throw new TypeError('Size must be a non-NaN number');
    }

    queue.push({ value: value, size: size });
};

exports.peekQueueValue = function (queue) {
    assert(queue.length > 0, 'Spec-level failure: should never be able to peek at an empty queue.');
    return queue[0].value;
};

exports.dequeueValue = function (queue) {
    assert(queue.length > 0, 'Spec-level failure: should never be able to dequeue from an empty queue.');
    var pair = queue.shift();
    return pair.value;
};

exports.getTotalQueueSize = function (queue) {
    var totalSize = 0;

    queue.forEach(function (pair) {
        assert(typeof pair.size === "number" && !isNaN(pair.size),
            'Spec-level failure: should never find an invalid size in the queue.');
        totalSize += pair.size;
    });

    return totalSize;
};
