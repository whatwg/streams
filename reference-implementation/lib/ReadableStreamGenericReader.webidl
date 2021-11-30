interface mixin ReadableStreamGenericReader {
  readonly attribute Promise<undefined> closed;

  Promise<undefined> cancel(optional any reason);
};
