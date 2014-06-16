#!/bin/bash

# Basically from https://medium.com/philosophy-logic/publishing-gh-pages-with-travis-ci-53a8270e87db

rm -rf out || exit 0;
mkdir out;
curl https://api.csswg.org/bikeshed/ -F file=@index.bs > out/index.html;

cd out
git init
git config user.name "Travis-CI"
git config user.email "travis@whatwg.org"
cp ../*.svg .
git add .
git commit -m "Deploy to GitHub Pages"
git push --force --quiet "https://${GH_TOKEN}@${GH_REF}" master:gh-pages > /dev/null 2>&1
