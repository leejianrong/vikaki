.DEFAULT_GOAL := help

# Run the CLI directly, not through pnpm: pnpm reports a clean Ctrl+C stop as a failed command.
CLI = cd packages/cli && exec ../../node_modules/.bin/tsx src/index.ts
.PHONY: demo-embed help lipsync-scorecard install install-voice install-renderer docker-build docker-test doctor build serve demo demo-speech extension e2e-smoke check hooks

help: ## List available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

install-voice: ## Install the real voice (Kokoro, about 410 MB) into .vikaki/voice
	node scripts/install-voice.mjs

install-renderer: ## Install the browser for headless rendering (Chromium, about 170 MB), for `vikaki stream` and `serve --headless`
	pnpm exec playwright install chromium

docker-build: ## Build both Docker images (vikaki, and vikaki-render with a browser)
	docker build --target vikaki -t vikaki .
	docker build --target vikaki-render -t vikaki-render .

docker-test: ## Build the images, start containers and check them (health, non-root, a driver speaks, the feed); takes minutes
	VIKAKI_DOCKER_TESTS=1 pnpm --filter @vikaki/e2e exec vitest run docker

lipsync-scorecard: build ## Score how the mouth follows eight recorded lines (needs Chromium; docs/observability.md)
	pnpm exec tsx scripts/lipsync-scorecard.ts

doctor: ## Check that everything the demos need is in place
	@( $(CLI) doctor ) || true  # the report is the output; `vikaki doctor` itself exits 1 on a problem, for scripts

build: ## Build the avatar page
	pnpm build

serve: build ## Build, then serve the avatar page on localhost
	@$(CLI) serve

demo: build ## Build, serve and open the demo page to judge the avatar by eye
	@$(CLI) serve --demo --open

demo-speech: install-voice build ## Install the real voice if needed, then open the speech demo
	@$(CLI) serve --speech-demo --open

demo-table: build ## Serve a table of three avatars (the real voice if installed); then run `make table-hand` in another terminal to play a hand
	@echo "Open http://127.0.0.1:8787/avatar?seats=3 and, in another terminal, run: make table-hand"
	@$(CLI) serve --port 8787 --personas $(CURDIR)/personas.table.example.yaml

demo-embed: build ## See the embed work: a stand-in game page frames the duet layout; type a line for either seat, press Start sound, press Cancel
	@$(CLI) embed-demo --open

table-hand: ## Play the scripted hand of poker at the running table, one driver per seat
	@$(CLI) table-demo --port 8787

extension: ## Build the browser extension into packages/extension/dist
	pnpm --filter @vikaki/extension build

e2e-smoke: ## Quick browser tests: the subset CI runs on every pull request
	pnpm test:e2e:smoke

e2e-ci: build ## The whole browser suite the way CI runs it (CI=1, two cores): catches timing flakes before the push
	CI=1 taskset -c 0,1 pnpm --filter @vikaki/e2e exec vitest run

check: ## Fast gate: typecheck + tests (what the pre-push hook runs)
	pnpm typecheck
	pnpm test

check-python: ## Python client tests against a fake hub (needs uv); CI also runs them against a real hub
	cd clients/python && uv run --extra dev pytest -q

check-poker: ## Poker example engine tests (needs uv; pure Python, no hub)
	cd examples/poker && uv run --extra dev pytest -q

hooks: ## Install the pre-push hook
	ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
	chmod +x scripts/git-hooks/pre-push
