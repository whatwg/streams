SHELL=/bin/bash -o pipefail
.PHONY: local remote deploy review

remote: index.bs
	curl https://api.csswg.org/bikeshed/ -f -F file=@index.bs > index.html -F md-Text-Macro="SNAPSHOT-LINK LOCAL COPY"

local: index.bs
	bikeshed spec index.bs index.html --md-Text-Macro="SNAPSHOT-LINK LOCAL COPY"

deploy: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/deploy.sh
	bash ./deploy.sh

review: index.bs
	curl --remote-name --fail https://resources.whatwg.org/build/review.sh
	bash ./review.sh
