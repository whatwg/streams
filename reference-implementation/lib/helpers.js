'use strict';

var Promise = require('es6-promise').Promise;

exports.promiseCall = function (func) {
    var args = Array.prototype.slice.call(arguments, 1);

    try {
        return Promise.cast(func.apply(undefined, args));
    } catch (e) {
        return Promise.reject(e);
    }
};
