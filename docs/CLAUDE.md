# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Crystallize AI documentation site**, built with [Astro Starlight](https://starlight.astro.build/) and deployed to GitHub Pages at `crystallizeapi.github.io/ai`.

## Commands

```bash
bun install         # Install dependencies
bun dev             # Start dev server (astro dev)
bun run build       # Production build (astro build)
bun run preview     # Preview production build locally
```

Runtime / Package manager: **Bun**

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

## Skills Reference

Everything that lists skills is generated from `use-crystallize/skills/`: the `skills` collection
(`src/loaders/skills-loader.ts`), the per-skill pages (`src/pages/skills/`), the sidebar entries
(`astro.config.mjs`) and the **Available Skills** grid in `guides/skills.mdx`
(`src/ui/components/astro/SkillsGrid.astro`). **Do not hand-maintain a skill list here** — that grid was
hand-written until it had drifted four skills behind. Dropping a directory with a `SKILL.md` into the skills
folder is enough for it to appear everywhere.

Frontmatter is read by a small hand-rolled parser rather than a YAML library. It handles inline values and
block scalars (`description: >`), which is all the skills use — anything fancier will parse as the marker
character instead of the value.

## MCP Server Tools Reference

The tool table in `guides/mcp.mdx` is **auto-generated** by the `mcpTools` content collection loader (`src/loaders/mcp-tools-loader.ts`), which parses the MCP Server's `toolRegistry` (`use-crystallize/mcp-servers/crystallize/src/core/container.ts`) and each tool file's `description`/`inputSchema` at build time. **Do not hand-maintain a tool list here** — it drifts. New tools appear on the docs page automatically once the server source adds them to `toolRegistry`.

The current tools fall into these groups (see the source for the authoritative list):

- **Reads** — `query-catalogue`, `query-discovery`, `query-core`, `query-shop-cart`, `fetch-content-model`, `fetch-catalog-graphql-schema`, `fetch-discovery-graphql-schema`, `fetch-core-graphql-schema`, `fetch-shop-cart-graphql-schema`, `build-mass-operation`, `get-mass-operation-status`, `skills`
- **UI panels** (gated by `?exposeUi`) — `tenant-overview`, `product-overview`
- **Writes** (gated by `?exposeWrite`, off by default) — `mutate-core`, `mutate-shop-cart`, `run-mass-operation`
