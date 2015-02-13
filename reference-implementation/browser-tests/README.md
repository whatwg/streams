# Streams Standard Tests, In Your Browser

This directory contains some preliminary work on creating a version of the [test suite](https://github.com/whatwg/streams/tree/master/reference-implementation/test) which can run in your browser, against any implementation that may be implemented there.

To set these up, run the command `npm run build-browser-tests`. This will generate a `bundle.js` in this directory. At that point, `index.html` + `bundle.js` together will be enough to run the tests. (The other files in this directory are for the build process.)
