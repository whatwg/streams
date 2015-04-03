import { createDataProperty } from './helpers';

export default class CountQueuingStrategy {
  constructor({ highWaterMark }) {
    createDataProperty(this, 'highWaterMark', highWaterMark);
  }

  size(chunk) {
    return 1;
  }
}
