#!/bin/bash

if [ "$DEPLOY_USER" == "" ]; then
    echo "No deploy credentials present; skipping deploy"
    exit 0
fi

SERVER="streams.spec.whatwg.org"
DESTINATION=$DEPLOY_USER:$DEPLOY_PASSWORD@$SERVER
WEB_ROOT="streams.spec.whatwg.org"
COMMITS_DIR="commit-snapshots"
BRANCHES_DIR="branch-snapshots"

SHA="`git rev-parse HEAD`"
BRANCH="`git rev-parse --abbrev-ref HEAD`"

if [ "$BRANCH" == "HEAD" ]; then # Travis does this for some reason
    BRANCH=$TRAVIS_BRANCH
fi


# Clear anything left over from last time
rm -rf out || exit 0

# Make a directory to put the output files
mkdir out

# Create the spec and save it in the local output directory
curl https://api.csswg.org/bikeshed/ -F file=@index.bs > out/index.html;

# Copy over any resources (for now just SVG) to the local output directory
cp *.svg out

# Install scp2 as a cross-platform scp that supports passwords
npm install -g scp2

for f in out/*; do
    # Deploy to the commit snapshot location
    scp2 $f $DESTINATION:$WEB_ROOT/$COMMITS_DIR/$SHA/
    echo "Deployed $f to /$COMMITS_DIR/$SHA/"

    if [ $BRANCH != "master" ] ; then
        # Deploy to the branch snapshot location, if not master
        scp2 $f $DESTINATION:$WEB_ROOT/$BRANCHES_DIR/$BRANCH/
        echo "Deployed $f to /$BRANCHES_DIR/$BRANCH/"
    else
        # Deploy master to the root
        scp2 $f $DESTINATION:$WEB_ROOT/
        echo "Deployed $f to /"
    fi
done
