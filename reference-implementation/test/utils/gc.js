export default () => {
  if (global.gc) {
    // Use --expose_gc for V8 (and io.js)
    // Exposed in SpiderMonkey shell as well
    global.gc();
  } else if (global.GCController) {
    // Present in some WebKit development environments
    GCController.collect();
  } else {
    console.warn('Tests are running without the ability to do manual garbage collection. They will still work, but ' +
      'coverage will be suboptimal.');
  }
};
