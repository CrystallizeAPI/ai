# Crystallize AI

Everything you need to use [Crystallize](https://crystallize.com) with AI agents — skills, MCP server, and documentation.

## Structure

This repo contains three sub-projects:

| Project        | Path                                       | Description                                                                                                       |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Skills**     | `use-crystallize/skills/`                  | Markdown-based skill modules for AI agents (query, mutation, content-model, pricing, permissions, etc.)           |
| **MCP Server** | `use-crystallize/mcp-servers/crystallize/` | Cloudflare Workers MCP server providing authenticated access to Crystallize APIs                                  |
| **Docs**       | `docs/`                                    | Astro Starlight documentation site deployed to [crystallizeapi.github.io/ai](https://crystallizeapi.github.io/ai) |

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Bun](https://bun.sh/)

## Getting Started

A root `Makefile` provides convenience targets for common tasks:

```bash
make install        # Install dependencies for all sub-projects
make codeclean      # Format (oxfmt) + type-check + lint
make tests          # Run the test suite
make serve-doc      # Start the documentation dev server
make serve-mcp      # Start the MCP dev server
```

Run `make` (or `make list`) to see all available targets.

### Docs

```bash
cd docs
bun install
bun dev             # Start dev server
bun run build       # Production build
bun run preview     # Preview production build
```

### MCP Server

```bash
cd use-crystallize/mcp-servers/crystallize
bun install
bun dev             # Vite dev server with HMR
bun build           # Production build
bun deploy          # Build + deploy to Cloudflare Workers
bun codeclean       # Lint + format (oxlint + oxfmt)
bun type-check      # TypeScript type checking
```

### Skills

Skills are plain markdown files in `use-crystallize/skills/` — no build step required. Each skill has a `SKILL.md` with YAML frontmatter and an optional `references/` directory with supporting docs.

Available skills: `query`, `mutation`, `content-model`, `js-api-client`, `permissions`, `pricing`, `information-architecture`.

## Using the Claude Plugin

The `use-crystallize/` directory is a Claude plugin. The plugin configuration lives in `use-crystallize/.claude-plugin/plugin.json` and references:

- **Skills** from `./skills/`
- **MCP Server** at `https://mcp.crystallize.com/mcp`

To connect to the MCP server, you need Crystallize access tokens configured in the headers:

```
X-Crystallize-Access-Token-Id: <your-token-id>
X-Crystallize-Access-Token-Secret: <your-token-secret>
```

## Inspect the MCP Locally

First start the MCP dev server:

```bash
make serve-mcp
```

Then add and inspect it:

```bash
bunx add-mcp http://localhost:5173/mcp \
  --header "X-Crystallize-Access-Token-Id: xxx" \
  --header "X-Crystallize-Access-Token-Secret: xxx"

bunx @modelcontextprotocol/inspector
```

## Contributing

Please read the [contribution guidelines](.github/CONTRIBUTING.md) before submitting a pull request.

## License

[MIT](LICENSE) — Copyright 2026 Crystallize.
