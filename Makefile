.DEFAULT_GOAL := help
.PHONY: help install build serve check hooks

help: ## List available targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

install: ## Install dependencies (frozen lockfile)
	pnpm install --frozen-lockfile

build: ## Build the avatar page
	pnpm build

serve: build ## Build, then serve the avatar page on localhost
	pnpm serve

check: ## Fast gate: typecheck + tests (what the pre-push hook runs)
	pnpm typecheck
	pnpm test

hooks: ## Install the pre-push hook
	ln -sf ../../scripts/git-hooks/pre-push .git/hooks/pre-push
	chmod +x scripts/git-hooks/pre-push
