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
- [pnpm](https://pnpm.io/)

## Getting Started

Each sub-project manages its own dependencies independently. Navigate to the project you want to work on and install:

### Docs

```bash
cd docs
pnpm install
pnpm dev        # Start dev server
pnpm build      # Production build
pnpm preview    # Preview production build
```

### MCP Server

```bash
cd use-crystallize/mcp-servers/crystallize
pnpm install
pnpm dev          # Vite dev server with HMR
pnpm build        # Production build
pnpm deploy       # Build + deploy to Cloudflare Workers
pnpm codeclean    # Lint + format (oxlint + oxfmt)
pnpm type-check   # TypeScript type checking
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

## Inspect the MCP locally

First you can add the MCP locally:

```bash
pnpm dlx add-mcp http://localhost:5173/mcp --header "X-Crystallize-Access-Token-Id: xxx" --header "X-Crystallize-Access-Token-Secret: xxx"
```

Then you can inspect it

```bash
pnpm dlx @modelcontextprotocol/inspector
```
