#!/bin/bash
set -e

if [ -d "web-platform-tests" ]; then
  cd web-platform-tests
  git pull origin master
else
  git clone --depth 1 https://github.com/w3c/web-platform-tests.git
fi
