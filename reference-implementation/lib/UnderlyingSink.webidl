dictionary UnderlyingSink {
  UnderlyingSinkStartCallback start;
  UnderlyingSinkWriteCallback write;
  UnderlyingSinkCloseCallback close;
  UnderlyingSinkAbortCallback abort;
  any type;
};

callback UnderlyingSinkStartCallback = any (WritableStreamDefaultController controller);
callback UnderlyingSinkWriteCallback = Promise<undefined> (any chunk, WritableStreamDefaultController controller);
callback UnderlyingSinkCloseCallback = Promise<undefined> ();
callback UnderlyingSinkAbortCallback = Promise<undefined> (optional any reason);
