dictionary UnderlyingSink {
  WritableStreamStartCallback start;
  WritableStreamWriteCallback write;
  WritableStreamCloseCallback close;
  WritableStreamAbortCallback abort;
  any type;
};

callback WritableStreamStartCallback = any (WritableStreamDefaultController controller);
callback WritableStreamWriteCallback = Promise<void> (WritableStreamDefaultController controller, optional any chunk);
callback WritableStreamCloseCallback = Promise<void> ();
callback WritableStreamAbortCallback = Promise<void> (optional any reason);
