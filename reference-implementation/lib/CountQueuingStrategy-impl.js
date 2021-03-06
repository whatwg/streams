'use strict';

exports.implementation = class CountQueuingStrategyImpl {
  constructor(globalObject, [{ highWaterMark }]) {
    this._globalObject = globalObject;
    this.highWaterMark = highWaterMark;
  }

  get size() {
    initializeSizeFunction(this._globalObject);
    return sizeFunctionWeakMap.get(this._globalObject);
  }
};

const sizeFunctionWeakMap = new WeakMap();
function initializeSizeFunction(globalObject) {
  if (sizeFunctionWeakMap.has(globalObject)) {
    return;
  }

  // We need to set the 'name' property:
  // The size function must not have a prototype property nor be a constructor
  const size = () => 1;
  sizeFunctionWeakMap.set(globalObject, size);
}
