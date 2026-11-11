INCLUDED = __init__.py current_disagreement.py rwkv_um_comparison.py workload_forecast.py stats.min.js stats-worker.js stats.min.css developers.md manifest.json config.json LICENSE ${wildcard locale/*.ftl}
OUT = searchStatsExtended.ankiaddon

COPIED = anki/graphs/Graph.sphelte

$(OUT): $(INCLUDED)
	./package.sh

stats.min.js: ${wildcard src/ts/*.ts src/ts/*.svelte src/ts/categories/*.ts src/ts/categories/*.svelte } esbuild.mjs src/ts/proto/ node_modules
	npm run format
	npm run build

stats-worker.js: stats.min.js
	@test -f $@ || npm run build

src/ts/proto/: node_modules
	mkdir -p src/ts/proto

	npx protoc \
		-I anki/proto \
		--es_out src/ts/proto \
		--es_opt target=ts \
		anki/proto/anki/*.proto \

	-find src/ts/proto -type f -name "*.ts" -exec sed -i '' -e 's/\.js//g' {} +

node_modules:
	npm i
