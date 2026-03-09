# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Crystallize AI documentation site**, built with [Astro Starlight](https://starlight.astro.build/) and deployed to GitHub Pages at `crystallizeapi.github.io/ai`.

## Commands

```bash
pnpm install        # Install dependencies
pnpm dev            # Start dev server (astro dev)
pnpm build          # Production build (astro build)
pnpm preview        # Preview production build locally
```

Package manager: **pnpm**

## Architecture

- **Framework**: Astro 5 with Starlight documentation theme
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` plugin, integrated with Starlight via `@astrojs/starlight-tailwind`
- **React**: Available for interactive components (`@astrojs/react` integration, JSX configured in tsconfig)
- **Content**: MDX files in `src/content/docs/` using Astro's content collections with Starlight's `docsLoader`
- **Sidebar**: Auto-generated from `src/content/docs/guides/` directory (configured in `astro.config.mjs`)
- **Custom components**: Starlight's `Footer` is overridden at `src/ui/components/astro/footer.astro`
- **Theme colors**: Custom accent (purple) and gray palettes defined in `src/tailwind.css`
- **Base path**: Site is served under `/ai` base path (derived from GitHub repo name in `astro.config.mjs`)

## Adding Documentation

Add new `.mdx` files to `src/content/docs/guides/` — they auto-appear in the sidebar. Use Starlight's built-in components (`Card`, `Steps`, `Code`, `Badge`, etc.) for rich content.

## MCP Server Tools Reference

The Crystallize MCP Server (documented in `guides/mcp.mdx`) exposes these tools:

- **`fetch-content-model`** — Fetches all shapes (content model) from a tenant
- **`fetch-catalog-graphql-schema`** — Fetches the compacted GraphQL schema of the Catalogue API
- **`fetch-discovery-graphql-schema`** — Fetches the compacted GraphQL schema of the Discovery API
- **`query-catalogue`** — Executes GraphQL queries against the Catalogue API (path-based reads, strong consistency)
- **`query-discovery`** — Executes GraphQL queries against the Discovery API (search, filter, faceting)
- **`skills`** — Retrieves Crystallize Skills documentation on-demand by slug
