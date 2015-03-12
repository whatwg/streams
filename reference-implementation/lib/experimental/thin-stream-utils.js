export function fillArrayBufferView(view, c, size) {
  if (size === undefined) {
    size = view.byteLength;
  }
  for (var i = 0; i < size; ++i) {
    view[i] = c;
  }
}
