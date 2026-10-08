.DEFAULT_GOAL := help

# Run the CLI directly, not through pnpm: pnpm reports a clean Ctrl+C stop as a failed command.
CLI = cd packages/cli && exec ../../node_modules/.bin/tsx src/index.ts
.PHONY: help install install-voice install-renderer doctor build serve demo demo-speech extension e2e-smoke check hooks

help: ## List available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-14s %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

install-voice: ## Install the real voice (Kokoro, about 410 MB) into .vikaki/voice
	node scripts/install-voice.mjs

install-renderer: ## Install the browser for headless rendering (Chromium, about 170 MB), for `vikaki stream` and `serve --headless`
	pnpm exec playwright install chromium

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

extension: ## Build the browser extension into packages/extension/dist
	pnpm --filter @vikaki/extension build

e2e-smoke: ## Quick browser tests: the subset CI runs on every pull request
	pnpm test:e2e:smoke

check: ## Fast gate: typecheck + tests (what the pre-push hook runs)
	pnpm typecheck
	pnpm test

hooks: ## Install the pre-push hook
	ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
	chmod +x scripts/git-hooks/pre-push
