dictionary UnderlyingSink {
  UnderlyingSinkStartCallback start;
  UnderlyingSinkWriteCallback write;
  UnderlyingSinkCloseCallback close;
  UnderlyingSinkAbortCallback abort;
  any type;
};

callback UnderlyingSinkStartCallback = any (WritableStreamDefaultController controller);
callback UnderlyingSinkWriteCallback = Promise<void> (WritableStreamDefaultController controller, optional any chunk);
callback UnderlyingSinkCloseCallback = Promise<void> ();
callback UnderlyingSinkAbortCallback = Promise<void> (optional any reason);
