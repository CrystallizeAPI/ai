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
bun run goals    # Print the Plausible goals to create (pass a tool name for one row)
```

## Project Structure

```
bin/
├── plausible-goals.ts                            # Prints the Plausible goals to create (`bun run goals`)
└── test-compacter.ts                             # Standalone script to test schema compaction
src/
├── index.ts                                      # Entry point (exports fetch handler)
├── app.ts                                        # Main Hono app — routes + MCP handler
├── contracts/
│   ├── analytics-tracker.ts                      # AnalyticsTracker / AnalyticsEvent / AnalyticsRequestContext types
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
│   ├── analytics.ts                              # Pure analytics event builders (tenant/tool + session paths)
│   ├── expose-flags.ts                           # Shared exposeWrite/exposeUi/exposeSkills query-param parsing
│   ├── mcp-request.ts                            # Detect the JSON-RPC `initialize` handshake (body-clone peek)
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
│       ├── analytics.ts                         # Plausible script snippet + custom-event goal names
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
- `analyticsTracker` — fire-and-forget Plausible event sender (**scoped**, not singleton — see Analytics below)

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
5. Add the tool's Plausible goal — run `bun run goals <tool-name>` to print just that one row, and create it in
   Site Settings → Goals. See below for why this step cannot be automated, and what happens if you skip it.

**Step 5 is a manual dashboard step, and it will be forgotten.** Plausible's Sites API — which has exactly the right
endpoint (`PUT /api/v1/sites/goals`, with `goal_type: "page"` and wildcard `page_path`) — is an **Enterprise-plan
feature**, and the Stats API that could reconcile goals against reality is Business-gated. On Growth there is no
programmatic path, so nothing in CI can check this for you.

The failure is soft, which is why it is easy to miss and also why it is not urgent:

- The new tool **is still tracked** — `/t/{tenant}/<new-tool>` is recorded from the first call, and it still counts
  toward the `total: tool calls` goal and appears in Top Pages.
- Only the **leaderboard row** is missing: the tool has no `tool: <name>` entry in Goal Conversions.
- **Pageview goals are retroactive**, so creating the goal later recovers the full history. Nothing is lost by
  noticing late — the counter is not zeroed the way a custom-event goal would be.

So the practical rule: `bun run goals` reprints the complete list from the real `toolRegistry` at any time. If the
Goals panel has fewer `tool:` rows than that list, the difference is what to create.

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

### Analytics (Plausible)

Usage is tracked in Plausible — **one site** (`PLAUSIBLE_DOMAIN`) for both the landing page and MCP tool calls.
There is no opt-out flag: unsetting `PLAUSIBLE_DOMAIN` disables everything.

**The account is on the Growth plan, so custom properties are unavailable** (they are Business-gated). Nothing sends
`props`. Every dimension is encoded in the event's URL **path**, which is free on every plan. The path shape is the
whole reporting model — do not change it without re-reading this section.

**MCP tool calls** — one `pageview` per call, fired from the single `handler` closure in `servicesProvider`:

```
/t/{tenant}/{tool}          e.g. /t/furniture/query-core
```

- Top Pages → one row per *(tenant, tool)* pair
- a pageview goal `/t/*/{tool}` → that tool summed across every tenant (the leaderboard)
- a `Page contains /t/{tenant}/` filter → that tenant summed across every tool

All three come from this one event. Plausible compiles a goal's `*` to `.*` anchored `^…$`, evaluates it at query
time (**so pageview goals are retroactive**, unlike custom-event goals), matches **every** goal a pageview satisfies,
and does not count goals toward the event quota.

**MCP session handshakes** — one `pageview` per JSON-RPC `initialize`, fired from `src/app.ts`:

```
/mcp/session/{tenant}/write-{on|off}/ui-{on|off}/skills-{on|off}
```

Tenant first, mirroring the tool path, so `Page contains /mcp/session/{tenant}/` is the same drill-down shape in
both reports. Eight rows per tenant, so Top Pages shows the joint distribution of connection configurations with no
goals at all; the three marginals come from three *overlapping* wildcard goals. The flags cannot ride in a query
string — Plausible strips those from the page path, collapsing every row into one.

**The tenant is weaker here than on a tool call, by nature.** At handshake time the client has not named a tenant, so
all we have is the credential's scope: exact for bearer auth, but an access token routinely spans several tenants
(a real one in this project sees three), and those sessions land on `_multiple`. That is not a gap to plug — the
tenant genuinely is not decided yet. It keeps cardinality low, since every multi-tenant token collapses into one
row, and the named-vs-`_multiple` split is itself the plugin-vs-token ratio.

Flag tokens are `/`-delimited, which is what stops a tenant legitimately named `write-on` from satisfying the
`cfg: write enabled` goal. There is a test for exactly that.

The event is emitted **after** the MCP handler answers and only when `response.ok` — the `/mcp/*` route pattern is
wider than the handler's own `route`, and the transport rejects bad `Accept`/`Content-Type`, so a client looping
against a trailing-slash URL would otherwise inflate the count with handshakes that only ever got a 404.

This counts handshakes, not people: a client that reconnects re-initialises and counts again.

`isInitializeRequest` (`src/core/mcp-request.ts`) peeks at a **clone** of the body (so the original still reaches the MCP
handler) and only for bodies under 8 KB, so a large tool-call payload is never buffered just to be discarded.

Goals must be created with **no custom property** attached. `custom_props` is one of exactly two things that trip
Plausible's plan gate on goal creation (`maybe_check_feature_access` in `lib/plausible/goals/goals.ex`; the other
is a revenue `currency`), so a prop-narrowed goal is *rejected outright* on Growth rather than degraded. It would
also be pointless: we send no properties, so such a goal would match nothing and sit at zero forever. The path is
the property mechanism here.

**Run `bun run goals`** to print the exact goal strings to create in Site Settings → Goals, or
`bun run goals <tool-name>` for a single row. It reads the real `toolRegistry`, so it cannot drift. Matching is
character-exact and a typo yields a goal that silently stays at zero.

**Adding a tool means adding a goal** — see step 5 of "To register a new tool" above. There is no way to automate
or verify it on the Growth plan: the Sites API (which creates goals) is Enterprise-only and the Stats API (which
could reconcile them) is Business-gated.

**Tenant resolution** (`src/core/analytics.ts`): `input.tenant` → else the only tenant on the credential (always the
case for bearer auth) → else the `_multiple` / `_unknown` sentinels. It never guesses. 14 of the 17 tools take a
`tenant` input which the SDK validates *before* the handler runs, so that branch is both common and exact. The
sentinels lead with `_`, which `tenantSchema` can never produce, so they cannot collide with a real tenant.

Every segment is slugged to `[a-z0-9-]` and capped at 128. This is load-bearing, not cosmetic: under bearer auth the
tenant comes from the unvalidated `X-Crystallize-Tenant-Identifier` header, and a slash in it would add a path
segment and break every wildcard goal.

**Delivery is fire-and-forget.** `AnalyticsTracker` returns `void`, not a promise, so no caller can put a third-party
round-trip on the request path; delivery goes through the `defer()`/`ctx.waitUntil` helper and every error is swallowed.

**Landing page** tracking is client-side (`src/pages/landing/analytics.ts`), using Plausible's **v2** script.

The site is identified by the script *filename* (`PLAUSIBLE_SCRIPT_URL`, a `pa-XXXX.js` from Site Settings → Site
installation) — the domain is compiled into that file. There is **no `data-domain`** (the v2 script does not read
one) and no `data-api`; configuration goes through `plausible.init()`. That URL is public by nature and is not a
secret. `PLAUSIBLE_DOMAIN` is unrelated to the landing page — it identifies the site for the *server-side* events.

Verified by reading the actual compiled script: `outboundLinks`, `fileDownloads` and `formSubmissions` are baked in
as enabled (so the GitHub / docs / app.crystallize.com links need no code and no Site Settings toggle, and the href
arrives as a `url` prop — one of Plausible's three *internal* prop keys, so that breakdown works without Business),
`autoCapturePageviews` is on, and `captureOnLocalhost` is off with the script itself skipping `localhost`, `127.x`,
`[::1]` and `file:`.

The only custom event is `Copy Install Command`, the page's one intent signal. Custom-event goals are **not**
retroactive, so create that goal before shipping.

**Gotchas that bite silently:**

- The Events API needs **no authentication** — the site is identified by the `domain` field alone, so config is a
  plain `var`, never a secret.
- `X-Forwarded-For` must carry `CF-Connecting-IP`. Omit it and Plausible sees the Worker's data-center egress IP and
  drops the event. (The inbound `X-Forwarded-For` is absent inside a Worker.)
- Plausible answers **HTTP 202 even when it discards the event**. The only signal is the `x-plausible-dropped: 1`
  response header, which the tracker logs via `console.warn`. Calls from cloud-hosted MCP clients arrive on
  data-center IPs and get filtered — watch that warning before trusting absolute numbers.
- The Goals panel is ranked by **unique visitors**, not conversions, and that ordering is hardcoded. For server-side
  events a "visitor" is a hash of IP + User-Agent + domain, i.e. roughly one client IP per day. Read the **Total
  conversions** column for call counts; the row *order* is a breadth signal, not a volume one.
- In Top Pages read the **pageviews** column, not the default visitors column — a visitor counts once per day
  regardless of how many calls it made.
- Visits, visit duration, bounce rate and entry/exit pages are **meaningless** for this traffic (they derive from a
  rolling 30-minute window over that coarse hash). That is precisely why session config lives in the path.
- `analyticsTracker` is registered **`.scoped()`**, and `defer` / `analyticsRequestContext` are registered on the
  request scope. `buildContainer` caches one container per isolate and ignores `env`, so anything request-derived
  registered as a singleton would freeze at the first request.
- Localhost **and `*.workers.dev`** are skipped. `PLAUSIBLE_DOMAIN` sits in top-level `vars`, so it binds to every
  deploy including preview URLs; without that guard a preview would file its traffic as production.
- `PLAUSIBLE_API_ENDPOINT` drives **both** sides: the server-side POST target, and the landing page's `data-api`
  plus its script origin. Point it at a self-hosted Plausible and the browser follows.

### AppContext Type

```ts
type AppContext = {
    Bindings: CloudflareBindings; // from wrangler types
    Variables: {
        accessTokenId: string;
        accessTokenSecret: string;
        services: Services; // { mcpServer, tenantMatcher, analyticsTracker }
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
- **Vars** (plain `vars` in `wrangler.jsonc`, none are secrets): `PLAUSIBLE_DOMAIN` (site ID for server-side MCP
  events; unset to disable them), `PLAUSIBLE_SCRIPT_URL` (the landing page's `pa-XXXX.js`; unset to drop the
  script) and `PLAUSIBLE_API_ENDPOINT` (override for a self-hosted Plausible or a first-party proxy — it feeds
  both the server-side POST and the browser's `plausible.init({ endpoint })`)
