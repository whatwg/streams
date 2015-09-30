'use strict';

self.getterRejects = function(test, obj, getterName, target, endTest) {
    var getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

    getter.call(target).then(
        test.step_func(function() { assert_unreached(getterName + ' should not fulfill'); }),
        test.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, getterName + ' should reject with a TypeError');
            if (endTest === true) {
                test.done();
            }
        }));
};

self.methodRejects = function (test, obj, methodName, target, endTest) {
    var method = obj[methodName];

    method.call(target).then(
        test.step_func(function() { assert_unreached(methodName + ' should not fulfill'); }),
        test.step_func(function(e) {
            assert_throws(new TypeError(), function() { throw e; }, methodName + ' should reject with a TypeError');
            if (endTest === true) {
                test.done();
            }
        }));
};

self.getterThrows = function (obj, getterName, target) {
  var getter = Object.getOwnPropertyDescriptor(obj, getterName).get;

    assert_throws(new TypeError(), function() { getter.call(target); }, getterName + ' should throw a TypeError');
};

self.methodThrows = function (obj, methodName, target) {
    var method = obj[methodName];

    assert_throws(new TypeError(), function() { method.call(target); }, methodName + ' should throw a TypeError');
};

self.garbageCollect = () => {
    if (self.gc) {
        // Use --expose_gc for V8 (and Node.js)
        // Exposed in SpiderMonkey shell as well
        self.gc();
    } else if (self.GCController) {
        // Present in some WebKit development environments
        GCController.collect();
    } else {
        console.warn('Tests are running without the ability to do manual garbage collection. They will still work, but ' +
          'coverage will be suboptimal.');
    }
};

self.delay = ms => new Promise(resolve => setTimeout(resolve, ms));
