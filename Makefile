SHELL=/bin/bash -o pipefail
.PHONY: local remote deploy review

remote: index.bs
	curl https://api.csswg.org/bikeshed/ -f -F file=@index.bs > index.html -F md-Text-Macro="COMMIT-SHA LOCAL COPY"

local: index.bs
	bikeshed spec index.bs index.html --md-Text-Macro="COMMIT-SHA LOCAL COPY"

deploy: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/deploy.sh
	EXTRA_FILES="demos/* demos/**/*" \
	bash ./deploy.sh

review: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/review.sh
	bash ./review.sh
