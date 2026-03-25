# === Makefile Helper ===

# Styles
YELLOW=$(shell echo "\033[00;33m")
RED=$(shell echo "\033[00;31m")
RESTORE=$(shell echo "\033[0m")

.DEFAULT_GOAL := list

.PHONY: list
list:
	@echo "******************************"
	@echo "${YELLOW}Available targets${RESTORE}:"
	@grep -E '^[a-zA-Z-]+:.*?## .*$$' Makefile | sort | awk 'BEGIN {FS = ":.*?## "}; {printf " ${YELLOW}%-15s${RESTORE} > %s\n", $$1, $$2}'
	@echo "${RED}==============================${RESTORE}"

.PHONY: install
install: ## Install
	@cd use-crystallize/mcp-servers/crystallize && bun install
	@cd docs && bun install

.PHONY: codeclean
codeclean: ## Code Clean
	@bun x oxfmt --write .
	@cd use-crystallize/mcp-servers/crystallize && bun run type-check
	@cd use-crystallize/mcp-servers/crystallize && bun run lint

.PHONY: tests
tests: ## Run the tests
	@cd use-crystallize/mcp-servers/crystallize && bun run test

.PHONY: serve-doc
serve-doc: ## Serve the documentation
	@cd docs && bun run dev

.PHONY: serve-mcp
serve-mcp: ## Serve the MCP server
	@cd use-crystallize/mcp-servers/crystallize && bun run dev


.PHONY: run-mcp-inspector
run-mcp-inspector: ## Run the MCP Inspector
	@cd use-crystallize/mcp-servers/crystallize && bun run dev



	
