# Crystallize AI

MCP server built on **Hono**, **Cloudflare Workers**, and the **Model Context Protocol SDK**.

## Quick Reference

```bash
pnpm dev          # Vite dev server with HMR
pnpm build        # Production build
pnpm deploy       # Build + deploy to Cloudflare
pnpm codeclean    # oxlint --fix && oxfmt --write .
pnpm type-check   # TypeScript check (no emit)
pnpm cf-typegen   # Regenerate CloudflareBindings types
```

## Project Structure

```
src/
├── index.ts                          # Entry point (exports fetch handler)
├── app.ts                            # Main Hono app — routes + MCP handler
├── core/
│   ├── container.ts                  # Awilix DI container + MCP server + tool registration
│   └── mcp/
│       └── tools/                    # MCP tool wrappers (one file per tool)
│           ├── hello.ts              # Example tool
│           └── skills.ts             # Skills/documentation retrieval tool
├── contracts/
│   ├── app-context.ts               # AppContext type (Bindings + Variables)
│   └── tool.ts                      # ToolWrapper type & defineToolWrapper helper
├── middlewares/
│   ├── auth.ts                      # Auth middleware (Crystallize access tokens)
│   └── services-provider.ts         # Awilix DI container middleware (per-request scope)
vite/
└── plugins/
    └── skills.ts                    # Vite plugin for loading skills from markdown files
```

## Architecture

### Routing (Hono)

- `/` — Simple text response
- `/mcp/*` — MCP protocol endpoint (auth-gated)
- Routes are defined directly in `src/app.ts`

### Dependency Injection (Awilix)

The app uses **Awilix** for dependency injection. The container is built once (singleton) in `src/core/container.ts` and scoped per-request via the `servicesProvider` middleware.

- `buildContainer(env)` creates the container, registers the `McpServer` and all tool wrappers
- `servicesProvider` middleware creates a scoped container per request, registers tools on the MCP server, and sets `services` on the Hono context
- Services are accessed in handlers via `c.get("services")`

### MCP Tools

Tools live in `src/core/mcp/tools/` as individual files. Each tool is a factory function returning a `ToolWrapper`:

```ts
// src/core/mcp/tools/my-tool.ts
import { defineToolWrapper } from "../../../contracts/tool";
import z from "zod";

type Deps = {
  // Awilix-injected dependencies
};

export const createMyToolWrapper = ({}: Deps) => {
  return defineToolWrapper({
    description: "What the tool does",
    inputSchema: z.object({
      param: z.string(),
    }),
    handler: async ({ param, authContext }) => {
      // authContext: { accessTokenId, accessTokenSecret }
      return { content: [{ type: "text", text: "result" }] };
    },
  });
};
```

To register a new tool:

1. Create the factory in `src/core/mcp/tools/`
2. Import it in `src/core/container.ts`
3. Add it to the `Container` type and `container.register()` call
4. Add the mapping in `toolRegistry` (`{ "tool-name": "containerKey" }`)

Auth context is injected automatically via `getMcpAuthContext()` from `agents/mcp`.

### Skills (Virtual Module)

The `skills` tool serves Crystallize documentation loaded at build time via a Vite plugin (`vite/plugins/skills.ts`). Skills are markdown files with frontmatter (`name`, `description`) loaded from `../../skills/` relative to the project root. Each skill directory contains a `SKILL.md` and optional `references/*.md` files. The virtual module `virtual:skills` is typed in `virtual-skills.d.ts`.

The `exposeSkills` query parameter (default: `true`) controls whether the skills tool is registered on the MCP server for a given request.

### AppContext Type

```ts
type AppContext = {
  Bindings: CloudflareBindings; // from wrangler types
  Variables: {
    accessTokenId: string;
    accessTokenSecret: string;
    services: Services; // { mcpServer: McpServer }
  };
};
```

Use `c.set()` / `c.get()` in middleware/handlers. Extend `Variables` when adding new request-scoped data.

## Code Conventions

- **Formatting**: oxfmt — 120 char width, 4-space indent, no tabs
- **Linting**: oxlint with typescript + react plugins. Unused vars prefixed with `_` are allowed
- **Zod v4** — use `z.email()` not `z.string().email()`, and other Zod v4 patterns
- **Hono JSX** — uses `hono/jsx`, not React. Import `JSX` from `hono/jsx/jsx-runtime`
- **ESM only** — `"type": "module"` in package.json
- **TypeScript** — strict mode, path imports use `.js` extensions for MCP SDK imports
- Run `pnpm codeclean` before committing

## Key Dependencies

| Package                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `hono`                      | Web framework (routing, middleware)           |
| `@modelcontextprotocol/sdk` | MCP server protocol                           |
| `agents`                    | Cloudflare Agents (MCP handler, auth context) |
| `awilix`                    | Dependency injection container                |
| `zod` (v4)                  | Schema validation for tool inputs             |
| `vite` (v7)                 | Build tooling                                 |

## Platform

- **Runtime**: Cloudflare Workers (with `nodejs_compat` flag)
- **Deployment**: Wrangler CLI
- **Smart placement** enabled in wrangler config
- Bindings type generated via `pnpm cf-typegen` → `worker-configuration.d.ts`
