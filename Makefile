BE_SRC=\
	src/compiler.ts \
	src/core.json \
	src/impl.ts \
	src/parser.js \
	src/serialize.ts \
	src/types.ts \
	be-license.js

W_SRC=\
	$(BE_SRC) \
	src/worker.ts \
	w-license.js

FE_SRC=\
	src/frontend.ts \
	fe-license.js

BIFY=node_modules/.bin/browserify

ADVANCED=-a transform-for-of,proposal-async-generator-functions

all: \
	eyc.js eyc-adv.js eyc-dbg.js \
	eyc-w.js eyc-w-adv.js eyc-w-dbg.js \
	eyc-fe.js eyc-fe-adv.js eyc-fe-dbg.js

eyc.js: $(BE_SRC) $(BIFY)
	./src/build.js src/impl.ts -t -l be-license.js > $@

eyc-adv.js: $(BE_SRC) $(BIFY)
	./src/build.js src/impl.ts -t -l be-license.js $(ADVANCED) > $@

eyc-dbg.js: $(BE_SRC) $(BIFY)
	./src/build.js src/impl.ts -g -l be-license.js $(ADVANCED) > $@

eyc-w.js: $(W_SRC) $(BIFY)
	./src/build.js src/worker.ts -t -l w-license.js > $@

eyc-w-adv.js: $(W_SRC) $(BIFY)
	./src/build.js src/worker.ts -t -l w-license.js $(ADVANCED) > $@

eyc-w-dbg.js: $(W_SRC) $(BIFY)
	./src/build.js src/worker.ts -g -l w-license.js $(ADVANCED) > $@

eyc-fe.js: $(FE_SRC) $(BIFY)
	./src/build.js src/frontend.ts -t -l fe-license.js > $@

eyc-fe-adv.js: $(FE_SRC) $(BIFY)
	./src/build.js src/frontend.ts -t -l fe-license.js $(ADVANCED) > $@

eyc-fe-dbg.js: $(FE_SRC) $(BIFY)
	./src/build.js src/frontend.ts -g -l fe-license.js $(ADVANCED) > $@

src/core.json: src/core.eyc
	./src/corecc.js

be-license.js: $(BIFY)
	./src/genlicense.js src/impl.ts > $@

w-license.js: $(BIFY)
	./src/genlicense.js src/worker.ts > $@

fe-license.js: $(BIFY)
	./src/genlicense.js src/frontend.ts > $@

src/parser.js: src/eyc.pegjs $(BIFY)
	./node_modules/.bin/pegjs -o $@ $<

$(BIFY):
	npm install

clean:
	rm -f \
		src/parser.js src/core.json \
		be-license.js w-license.js fe-license.js \
		eyc.js eyc-adv.js eyc-dbg.js \
		eyc-w.js eyc-w-adv.js eyc-w-dbg.js \
		eyc-fe.js eyc-fe-adv.js eyc-fe-dbg.js

distclean: clean
	rm -rf node_modules
