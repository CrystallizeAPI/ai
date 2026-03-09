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
bin/
└── test-compacter.ts                     # Standalone script to test schema compaction
src/
├── index.ts                              # Entry point (exports fetch handler)
├── app.ts                                # Main Hono app — routes + MCP handler
├── contracts/
│   ├── app-context.ts                    # AppContext type (Bindings + Variables)
│   ├── graphql-query-corrector.ts        # Query correction types (CorrectionResult, CorrectionLog)
│   ├── graphql-schema-compacter.ts       # Schema compaction types (GraphqlSchemaCompacter, options)
│   ├── query-executor.ts                 # Query execution types (QueryExecutor, options, result)
│   ├── tenant-matcher.ts                 # TenantMatcher type
│   └── tool.ts                           # ToolWrapper type & defineToolWrapper helper
├── core/
│   ├── container.ts                      # Awilix DI container + services + tool registration
│   ├── mcp/
│   │   └── tools/                        # MCP tool wrappers (one file per tool)
│   │       ├── fetch-catalog-graphql-schema.ts   # Fetch compacted Catalogue API schema
│   │       ├── fetch-content-model.ts            # Fetch tenant shapes/content model
│   │       ├── fetch-discovery-graphql-schema.ts # Fetch compacted Discovery API schema
│   │       ├── query-catalogue.ts                # Execute Catalogue API queries (with auto-correction)
│   │       ├── query-discovery.ts                # Execute Discovery API queries (with auto-correction)
│   │       └── skills.ts                         # Skills/documentation retrieval tool
│   └── services/
│       ├── compact-schema-builder.ts     # GraphQL schema compaction (introspection → compact text)
│       ├── graphql-query-corrector.ts    # Auto-correct malformed GraphQL queries (Levenshtein)
│       ├── query-with-correction.ts      # Execute queries with auto-correction on failure
│       └── tenant-matcher.ts             # Match tenant by id/identifier from auth context
├── middlewares/
│   ├── auth.ts                           # Auth middleware (Crystallize access tokens)
│   └── services-provider.ts              # Awilix DI container middleware (per-request scope)
vite/
└── plugins/
    └── skills.ts                         # Vite plugin for loading skills from markdown files
```

## Architecture

### Routing (Hono)

- `/` — Simple text response
- `/mcp/*` — MCP protocol endpoint (auth-gated)
- Routes are defined directly in `src/app.ts`

### Dependency Injection (Awilix)

The app uses **Awilix** for dependency injection. The container is built once (singleton) in `src/core/container.ts` and scoped per-request via the `servicesProvider` middleware.

- `buildContainer(env)` creates the container, registers services (singletons) and tool wrappers
- `servicesProvider` middleware creates a scoped container per request, registers tools on the MCP server, and sets `services` on the Hono context
- Services are accessed in handlers via `c.get("services")`

#### Container Registrations

**Services** (singletons):
- `tenantMatcher` — resolve tenant from auth context
- `graphqlSchemaCompacter` — compact introspection schemas
- `graphqlQueryCorrector` — fix malformed GraphQL queries
- `queryExecutor` — execute queries with auto-correction

**Tools** (singletons):
- `skillsToolWrapper`, `queryDiscoveryToolWrapper`, `queryCatalogueToolWrapper`
- `fetchContentModelToolWrapper`, `fetchCatalogGraphqlSchemaToolWrapper`, `fetchDiscoveryGraphqlSchemaToolWrapper`

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

#### Tool Registry

| Tool Name | Container Key | Purpose |
|-----------|---------------|---------|
| `skills` | `skillsToolWrapper` | Load Crystallize documentation |
| `query-discovery` | `queryDiscoveryToolWrapper` | Execute Discovery API queries |
| `query-catalogue` | `queryCatalogueToolWrapper` | Execute Catalogue API queries |
| `fetch-content-model` | `fetchContentModelToolWrapper` | Fetch tenant shapes |
| `fetch-catalog-graphql-schema` | `fetchCatalogGraphqlSchemaToolWrapper` | Get compacted Catalogue schema |
| `fetch-discovery-graphql-schema` | `fetchDiscoveryGraphqlSchemaToolWrapper` | Get compacted Discovery schema |

Auth context is injected automatically via `getMcpAuthContext()` from `agents/mcp`.

### Services

Services live in `src/core/services/` and implement contracts defined in `src/contracts/`.

#### Query Execution Pipeline

```
MCP Tool (query-catalogue / query-discovery)
  ↓
queryExecutor → executes GraphQL query
  ├─ Success → return data
  └─ Error → graphqlQueryCorrector
      ├─ Correctable (Levenshtein fuzzy match on fields/args) → retry with corrected query
      └─ Not correctable → return error details
```

#### Schema Compaction

The `graphqlSchemaCompacter` service reduces GraphQL introspection schemas to a compact text format (50-70% smaller):

1. Fetches introspection from endpoint
2. BFS reachability analysis from root queries/mutations
3. Deduplicates interface fields in implementing types
4. Extracts common field groups (appearing in 3+ types)
5. Renders compact human-readable format

Used by `fetch-catalog-graphql-schema` and `fetch-discovery-graphql-schema` tools.

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
| `graphql`                   | Introspection, validation, AST manipulation   |
| `fastest-levenshtein`       | Fuzzy matching for query auto-correction      |
| `vite` (v7)                 | Build tooling                                 |

## Platform

- **Runtime**: Cloudflare Workers (with `nodejs_compat` flag)
- **Deployment**: Wrangler CLI
- **Smart placement** enabled in wrangler config
- Bindings type generated via `pnpm cf-typegen` → `worker-configuration.d.ts`
