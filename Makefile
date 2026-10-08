.DEFAULT_GOAL := help
.PHONY: help install build serve demo extension check hooks

help: ## List available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

build: ## Build the avatar page
	pnpm build

serve: build ## Build, then serve the avatar page on localhost
	pnpm serve

demo: build ## Build, serve and open the demo page to judge the avatar by eye
	pnpm --filter @vikaki/cli dev serve --demo --open

extension: ## Build the browser extension into packages/extension/dist
	pnpm --filter @vikaki/extension build

check: ## Fast gate: typecheck + tests (what the pre-push hook runs)
	pnpm typecheck
	pnpm test

hooks: ## Install the pre-push hook
	ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
	chmod +x scripts/git-hooks/pre-push
