# Crystallize AI

MCP server built on **Hono**, **Cloudflare Workers**, and the **Model Context Protocol SDK**.

## Quick Reference

```bash
bun dev          # Vite dev server with HMR
bun build        # Production build
bun deploy       # Build + deploy to Cloudflare
bun lint         # oxlint --fix
bun test         # Run the test suite (bun test)
bun type-check   # TypeScript check (no emit)
bun cf-typegen   # Regenerate CloudflareBindings types
```

## Project Structure

```
bin/
└── test-compacter.ts                             # Standalone script to test schema compaction
src/
├── index.ts                                      # Entry point (exports fetch handler)
├── app.ts                                        # Main Hono app — routes + MCP handler
├── contracts/
│   ├── app-context.ts                            # AppContext type (Bindings + Variables)
│   ├── auth-context-resolver.ts                  # AuthContextResolver type (resolve client credentials)
│   ├── core-schema-domain-splitter.ts            # Core schema domain-splitting types
│   ├── graphql-query-corrector.ts                # Query correction types (CorrectionResult, CorrectionLog)
│   ├── graphql-schema-compacter.ts               # Schema compaction types (GraphqlSchemaCompacter, options)
│   ├── mass-operation-runner.ts                  # MassOperationRunner types (task + status)
│   ├── mutation-executor.ts                      # MutationExecutor type (execute-once, no retry)
│   ├── query-executor.ts                         # Query execution types (QueryExecutor, options, result)
│   ├── tenant-matcher.ts                         # TenantMatcher type
│   └── tool.ts                                   # ToolWrapper type (incl. write marker) & defineToolWrapper helper
├── core/
│   ├── container.ts                              # Awilix DI container + services + tool registration
│   ├── mass-operation.ts                         # Shared mass-operation validation (validateMassOperations)
│   ├── security.ts                               # Shared input schemas (tenant/query/variables) + error sanitization
│   ├── mcp/
│   │   └── tools/                                # MCP tool wrappers (one file per tool)
│   │       ├── build-mass-operation.ts           # Validate a mass-operation file (read-only)
│   │       ├── fetch-catalog-graphql-schema.ts   # Fetch compacted Catalogue API schema
│   │       ├── fetch-content-model.ts            # Fetch tenant shapes/content model
│   │       ├── fetch-core-graphql-schema.ts      # Fetch compacted Core API schema (by domain)
│   │       ├── fetch-discovery-graphql-schema.ts # Fetch compacted Discovery API schema
│   │       ├── fetch-shop-cart-graphql-schema.ts # Fetch compacted Shop Cart API schema
│   │       ├── get-mass-operation-status.ts      # Poll a mass-operation bulk task (read-only)
│   │       ├── mutate-core.ts                    # Execute Core/PIM mutations (write)
│   │       ├── mutate-shop-cart.ts               # Execute Shop Cart mutations (write)
│   │       ├── product-overview.ts               # Render Discovery product hits as a UI panel
│   │       ├── query-catalogue.ts                # Execute Catalogue API queries (with auto-correction)
│   │       ├── query-core.ts                     # Execute Core API read queries (with auto-correction)
│   │       ├── query-discovery.ts                # Execute Discovery API queries (with auto-correction)
│   │       ├── query-shop-cart.ts                # Execute Shop Cart read queries (with auto-correction)
│   │       ├── run-mass-operation.ts             # Validate, upload & start a mass operation (write)
│   │       ├── skills.ts                         # Skills/documentation retrieval tool
│   │       └── tenant-overview.ts                # Show connected tenants as a UI panel
│   └── services/
│       ├── auth-context-helpers.ts               # Resolve client credentials from auth (token/session/bearer)
│       ├── compact-schema-builder.ts             # GraphQL schema compaction (introspection → compact text)
│       ├── core-schema-domain-splitter.ts        # Split the Core schema into queryable domains
│       ├── execute-mutation.ts                   # Execute-once mutation executor (no correction, no retry)
│       ├── graphql-query-corrector.ts            # Auto-correct malformed GraphQL queries (Levenshtein)
│       ├── mass-operation-runner.ts              # Upload + create + start bulk tasks; read task status
│       ├── query-with-correction.ts              # Execute queries with auto-correction on failure
│       └── tenant-matcher.ts                     # Match tenant by id/identifier from auth context
├── middlewares/
│   ├── auth.ts                                   # Auth middleware (Crystallize access tokens)
│   └── services-provider.ts                      # Awilix DI container middleware (per-request scope)
├── pages/
│   └── landing/                                 # HTML landing page served at `/`
│       ├── index.ts                             # landingPage() — assembles the page
│       ├── features.ts                          # Feature grid cards (title + badge)
│       ├── meta.ts                              # Page <head> meta tags
│       ├── physics.ts                           # Matter.js pinball background script
│       └── styles.ts                            # Inline CSS
vite/
└── plugins/
    └── skills.ts                                 # Vite plugin for loading skills from markdown files
```

## Architecture

### Routing (Hono)

- `/` — HTML landing page (`landingPage()` from `src/pages/landing/`)
- `/mcp/*` — MCP protocol endpoint (auth-gated)
- Routes are defined directly in `src/app.ts`

### Dependency Injection (Awilix)

The app uses **Awilix** for dependency injection. The container is built once (singleton) in `src/core/container.ts` and scoped per-request via the `servicesProvider` middleware.

- `buildContainer(env)` creates the container, registers services (singletons) and tool wrappers
- `servicesProvider` middleware creates a scoped container per request, registers tools on the MCP server, and sets `services` on the Hono context
- Services are accessed in handlers via `c.get("services")`

#### Container Registrations

**Services** (singletons):

- `authContextResolver` — resolve client credentials from the auth context (token/session/bearer)
- `tenantMatcher` — resolve tenant from auth context
- `graphqlSchemaCompacter` — compact introspection schemas
- `coreSchemaDomainSplitter` — split the Core schema into queryable domains
- `graphqlQueryCorrector` — fix malformed GraphQL queries
- `queryExecutor` — execute queries with auto-correction
- `mutationExecutor` — execute mutations exactly once (no correction, no retry)
- `massOperationRunner` — upload + create + start mass-operation bulk tasks; read task status

**Tools** (singletons) — see the Tool Registry table below for the full list. Read tools:

- `skillsToolWrapper`, `queryDiscoveryToolWrapper`, `queryCatalogueToolWrapper`, `queryCoreToolWrapper`, `queryShopCartToolWrapper`
- `fetchContentModelToolWrapper`, `fetchCatalogGraphqlSchemaToolWrapper`, `fetchDiscoveryGraphqlSchemaToolWrapper`, `fetchCoreGraphqlSchemaToolWrapper`, `fetchShopCartGraphqlSchemaToolWrapper`
- `buildMassOperationToolWrapper`, `getMassOperationStatusToolWrapper`
- `tenantOverviewToolWrapper`, `productOverviewToolWrapper` _(UI — gated by `exposeUi`)_

Write tools _(gated by `exposeWrite`)_:

- `mutateCoreToolWrapper`, `mutateShopCartToolWrapper`, `runMassOperationToolWrapper`

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

| Tool Name                        | Container Key                            | Purpose                                  |
| -------------------------------- | ---------------------------------------- | ---------------------------------------- |
| `skills`                         | `skillsToolWrapper`                      | Load Crystallize documentation           |
| `query-discovery`                | `queryDiscoveryToolWrapper`              | Execute Discovery API queries            |
| `query-catalogue`                | `queryCatalogueToolWrapper`              | Execute Catalogue API queries            |
| `query-core`                     | `queryCoreToolWrapper`                   | Execute Core/PIM read queries            |
| `query-shop-cart`                | `queryShopCartToolWrapper`               | Execute Shop Cart read queries           |
| `fetch-content-model`            | `fetchContentModelToolWrapper`           | Fetch tenant shapes / content model      |
| `fetch-catalog-graphql-schema`   | `fetchCatalogGraphqlSchemaToolWrapper`   | Get compacted Catalogue schema           |
| `fetch-discovery-graphql-schema` | `fetchDiscoveryGraphqlSchemaToolWrapper` | Get compacted Discovery schema           |
| `fetch-core-graphql-schema`      | `fetchCoreGraphqlSchemaToolWrapper`      | Get compacted Core schema (by domain)    |
| `fetch-shop-cart-graphql-schema` | `fetchShopCartGraphqlSchemaToolWrapper`  | Get compacted Shop Cart schema           |
| `build-mass-operation`           | `buildMassOperationToolWrapper`          | Validate a mass-operation file           |
| `get-mass-operation-status`      | `getMassOperationStatusToolWrapper`      | Poll a mass-operation bulk task          |
| `tenant-overview` _(ui)_         | `tenantOverviewToolWrapper`              | Show connected tenants (UI panel)        |
| `product-overview` _(ui)_        | `productOverviewToolWrapper`             | Render Discovery product hits (UI panel) |
| `mutate-core` _(write)_          | `mutateCoreToolWrapper`                  | Execute Core/PIM mutations               |
| `mutate-shop-cart` _(write)_     | `mutateShopCartToolWrapper`              | Execute Shop Cart mutations              |
| `run-mass-operation` _(write)_   | `runMassOperationToolWrapper`            | Run a mass operation (one-shot)          |

Auth context is injected automatically via `getMcpAuthContext()` from `agents/mcp`.

#### Write tools & the `exposeWrite` gate

The server is **read-only by default**. Tools that mutate the tenant carry a `write: true` marker on their
`ToolWrapper` and are only registered when a request opts in via `?exposeWrite=true` (default off — the opposite
default of `exposeSkills`/`exposeUi`). The middleware skips `wrapper.write` tools unless `exposeWrite` is set.

Write tools (`mutate-core`, `mutate-shop-cart`, `run-mass-operation`):

- Are **mutation-only** for the GraphQL tools — they reject plain queries and mixed query/mutation documents,
  pointing the agent to the `query-*` read tool instead.
- **Execute exactly once** via `mutationExecutor` — no Levenshtein auto-correction or retry (a failed mutation is
  never silently re-sent), unlike reads which go through `queryExecutor`.
- Advertise `annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }`. The middleware
  honors each wrapper's `annotations` (falling back to `{ readOnlyHint: true }`); it no longer hardcodes read-only.

`get-mass-operation-status` is a read (`readOnlyHint: true`) and is **always registered**, even in read-only mode.

`run-mass-operation` is one-shot: it validates against `OperationsSchema`, uploads the file (`createBinaryFileManager`),
creates the bulk task with `autoStart: false`, then starts it — returning `{ taskId, status }`. There is no server-side
polling; the agent polls `get-mass-operation-status` itself. All three auth types (token/session/bearer) may write;
upstream Crystallize permissions are the real authorization.

### Services

Services live in `src/core/services/` and implement contracts defined in `src/contracts/`.

#### Query Execution Pipeline

```
MCP Tool (query-catalogue / query-discovery / query-core / query-shop-cart)
  ↓
queryExecutor → executes GraphQL query
  ├─ Success → return data
  └─ Error → graphqlQueryCorrector
      ├─ Correctable (Levenshtein fuzzy match on fields/args) → retry with corrected query
      └─ Not correctable → return error details
```

#### Mutation Execution Pipeline (write tools)

```
MCP Tool (mutate-core / mutate-shop-cart)
  ↓
parse query → reject plain queries & mixed query/mutation documents (point to the query-* read tool)
  ↓
mutationExecutor → executes the mutation EXACTLY ONCE
  ├─ Success → return data
  └─ Error → surface GraphQL errors as-is (NO corrector, NO retry — a failed mutation is never re-sent)
```

`mutationExecutor` is the deliberate counterpart of `queryExecutor`: it skips the query corrector and never retries.

#### Mass Operations

```
build-mass-operation      → validate operations file (read-only pre-flight)
run-mass-operation        → validate → upload file → create bulk task (autoStart:false) → start → { taskId, status }
get-mass-operation-status → read bulk task by taskId → { id, status }
```

`validateMassOperations` (in `core/mass-operation.ts`) is shared by `build-mass-operation` and `run-mass-operation`, so an invalid file yields the same structured errors in both. `massOperationRunner` drives the upstream `nextPimApi` calls (create/start/status); `BulkTaskMassOperation` exposes no `progress` field, so status is the only signal — the agent polls `get-mass-operation-status` itself (no server-side polling).

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

The `exposeSkills` query parameter (default: `true`) controls whether the skills tool is registered on the MCP server for a given request. Companion flags: `exposeUi` (default `true`, gates UI tools) and `exposeWrite` (default `false`, gates write tools — see "Write tools & the `exposeWrite` gate" above).

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

- **Formatting**: 120 char width, 4-space indent, no tabs (project convention — no dedicated formatter)
- **Linting**: oxlint (`bun lint`, config in `.oxlintrc.json`) with typescript + react plugins. Unused vars/args/caught-errors prefixed with `_` are allowed
- **Zod v4** — use `z.email()` not `z.string().email()`, and other Zod v4 patterns
- **Hono JSX** — uses `hono/jsx`, not React. Import `JSX` from `hono/jsx/jsx-runtime`
- **ESM only** — `"type": "module"` in package.json
- **TypeScript** — strict mode, path imports use `.js` extensions for MCP SDK imports
- Run `bun lint` before committing

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
- Bindings type generated via `bun cf-typegen` → `worker-configuration.d.ts`
