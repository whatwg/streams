#!/bin/bash
set -e

if [ "$DEPLOY_USER" == "" ]; then
    echo "No deploy credentials present; skipping deploy"
    exit 0
fi

LS_URL="https://streams.spec.whatwg.org/"
COMMIT_URL_BASE="https://github.com/whatwg/streams/commit/"
BRANCH_URL_BASE="https://github.com/whatwg/streams/tree/"

SERVER="streams.spec.whatwg.org"
WEB_ROOT="streams.spec.whatwg.org"
COMMITS_DIR="commit-snapshots"
BRANCHES_DIR="branch-snapshots"

SHA="`git rev-parse HEAD`"
BRANCH="`git rev-parse --abbrev-ref HEAD`"
if [ "$BRANCH" == "HEAD" ]; then # Travis does this for some reason
    BRANCH=$TRAVIS_BRANCH
fi

rm -rf $WEB_ROOT || exit 0

# Commit snapshot
COMMIT_DIR=$WEB_ROOT/$COMMITS_DIR/$SHA
mkdir -p $COMMIT_DIR
curl https://api.csswg.org/bikeshed/ -F file=@index.bs -F md-status=LS-COMMIT \
     -F md-warning="Commit $SHA $COMMIT_URL_BASE$SHA replaced by $LS_URL" \
     -F md-title="Streams Standard (Commit Snapshot $SHA)" \
     > $COMMIT_DIR/index.html;
cp *.svg $COMMIT_DIR

if [ $BRANCH != "master" ] ; then
    # Branch snapshot, if not master
    BRANCH_DIR=$WEB_ROOT/$BRANCHES_DIR/$BRANCH
    mkdir -p $BRANCH_DIR
    curl https://api.csswg.org/bikeshed/ -F file=@index.bs -F md-status=LS-BRANCH \
         -F md-warning="Branch $BRANCH $BRANCH_URL_BASE$BRANCH replaced by $LS_URL" \
         -F md-title="Streams Standard (Branch Snapshot $BRANCH)" \
         > $BRANCH_DIR/index.html;
    cp *.svg $BRANCH_DIR
else
    # Living standard, if master
    curl https://api.csswg.org/bikeshed/ -F file=@index.bs > $WEB_ROOT/index.html;
    cp *.svg $WEB_ROOT
fi

# scp the output directory up
sudo apt-get install sshpass
sshpass -p $DEPLOY_PASSWORD scp -r -o StrictHostKeyChecking=no $WEB_ROOT $DEPLOY_USER@$SERVER:
