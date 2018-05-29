remote: index.bs
	curl https://api.csswg.org/bikeshed/ -f -F file=@index.bs > index.html.postbs -F md-Text-Macro="SNAPSHOT-LINK LOCAL COPY"
	node_modules/.bin/emu-algify --throwing-indicators < index.html.postbs > index.html

local: index.bs
	bikeshed spec index.bs index.html.postbs --md-Text-Macro="SNAPSHOT-LINK LOCAL COPY"
	node_modules/.bin/emu-algify --throwing-indicators < index.html.postbs > index.html

deploy: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/deploy.sh
	EXTRA_FILES="demos/**/*" \
	POST_BUILD_STEP='node_modules/.bin/emu-algify --throwing-indicators < "$$DIR/index.html" > "$$DIR/index.html.tmp"; mv "$$DIR/index.html.tmp" "$$DIR/index.html"' \
	bash ./deploy.sh

review: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/review.sh
	bash ./review.sh
