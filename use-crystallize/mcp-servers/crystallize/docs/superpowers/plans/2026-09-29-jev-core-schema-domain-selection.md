# Jev Core Schema Domain Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `fetch-core-graphql-schema` take a natural-language `intent` and return the compacted schema of every Core API domain that intent needs, chosen by TypeSafe's Jev model on Workers AI, in one call.

**Architecture:** A new `coreDomainSelector` service asks Jev one Noul ("is this domain needed?") per domain in a single request, with the intent and the domain index as state. It keeps the domains above a threshold (capped), and the splitter compacts their union into one schema. `domain` stays as an exact override; any Jev failure or an empty selection falls back to today's domain index, so Jev can never break the tool.

**Tech Stack:** Cloudflare Workers + Workers AI binding (`typesafe/jev`), Hono, Awilix, Zod v4, Bun test.

**Spec:** No separate spec document. The design was agreed in conversation on 2026-09-29 and is restated in Goal/Architecture above and in Global Constraints below.

## Global Constraints

- Package root for every path below: `use-crystallize/mcp-servers/crystallize/`. Run all commands from there.
- Model id: `typesafe/jev` (Workers AI, 32,000-token context, $0.042 / 1M input tokens, output free).
- Jev Noul answer shape: `{ "type": "noul", "noul": <0..1> }` under `response.answers[<questionId>]`.
- Selection policy (tuned in Task 6 on 12 live cases: 12/12 full recall at 0.2, 0.3 and 0.5): keep domains with probability `>= 0.5`, sorted descending, at most `4`.
- `domain` input wins over `intent` when both are given (exact, no Jev call).
- A Jev failure, a blank intent, or an empty selection must return the domain index, never an error.
- No new npm dependencies.
- Code style: 4-space indent, 120-char width, Zod v4, ESM. Run `bun lint` before each commit.
- Work on a branch, not `main`: `git checkout -b feat/jev-core-domain-selection`.

## Review Focus

1. **Jev unavailable** (binding missing in local dev, outage, 32k context exceeded on a huge schema) → tool returns the domain index with a note, not "Failed to fetch core schema". Pinned in Task 4 (`falls back to the index when the selector throws`).
2. **Blank or whitespace `intent`** → treated as no intent (domain index), and Jev is not called. Pinned in Task 2 and Task 4.
3. **Both `domain` and `intent` given** → exact `domain` wins, selector not called. Pinned in Task 4.
4. **Jev response missing some answer ids** → those domains are skipped, the rest still used. Pinned in Task 2.
5. **Malformed Jev response** (no `answers`) → treated as failure → fallback. Pinned in Task 1 (client throws) + Task 4 (fallback on throw).

---

### Task 1: Jev client

**Files:**
- Create: `src/contracts/jev.ts`
- Create: `src/core/services/jev-client.ts`
- Test: `tests/core/services/jev-client.test.ts`

**Interfaces:**
- Produces:
  - `type JevNoulQuestion = { type: "noul"; instructions: string; criteria?: { true: string; false: string } }`
  - `type JevRequest = { state: unknown; questions: Record<string, JevNoulQuestion> }`
  - `type JevResponse = { model: string; answers: Record<string, { type: "noul"; noul: number }>; usage?: { input_tokens: number; output_tokens: number } }`
  - `type JevClient = (request: JevRequest) => Promise<JevResponse>`
  - `const JEV_MODEL = "typesafe/jev"`
  - `type JevBinding = { run(model: typeof JEV_MODEL, input: JevRequest): Promise<unknown> }`
  - `createJevClient({ ai }: { ai: JevBinding }): JevClient`

- [ ] **Step 1: Write the failing test**

`tests/core/services/jev-client.test.ts`:

```ts
import { describe, it, expect, mock } from "bun:test";
import { createJevClient, JEV_MODEL, type JevBinding } from "../../../src/core/services/jev-client";
import type { JevRequest } from "../../../src/contracts/jev";

const request: JevRequest = {
    state: { intent: "list orders" },
    questions: { d0: { type: "noul", instructions: "Is the order domain needed?" } },
};

describe("createJevClient", () => {
    it("runs typesafe/jev with the request and returns the response", async () => {
        const response = { model: "jev-1.13.0", answers: { d0: { type: "noul", noul: 0.9 } } };
        const run = mock(async () => response);
        const client = createJevClient({ ai: { run } as JevBinding });

        expect(await client(request)).toEqual(response);
        expect(run).toHaveBeenCalledWith(JEV_MODEL, request);
    });

    it("throws when the response has no answers", async () => {
        const client = createJevClient({ ai: { run: async () => ({}) } as JevBinding });
        await expect(client(request)).rejects.toThrow("Jev returned no answers");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/services/jev-client.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/services/jev-client`.

- [ ] **Step 3: Write minimal implementation**

`src/contracts/jev.ts`:

```ts
export type JevNoulQuestion = {
    type: "noul";
    instructions: string;
    criteria?: { true: string; false: string };
};

export type JevRequest = {
    state: unknown;
    questions: Record<string, JevNoulQuestion>;
};

export type JevResponse = {
    model: string;
    answers: Record<string, { type: "noul"; noul: number }>;
    usage?: { input_tokens: number; output_tokens: number };
};

export type JevClient = (request: JevRequest) => Promise<JevResponse>;
```

`src/core/services/jev-client.ts`:

```ts
import type { JevClient, JevRequest, JevResponse } from "../../contracts/jev";

export const JEV_MODEL = "typesafe/jev";

// The generated `Ai` types predate typesafe/jev, so the binding is narrowed to the one call we make.
export type JevBinding = {
    run(model: typeof JEV_MODEL, input: JevRequest): Promise<unknown>;
};

export const createJevClient =
    ({ ai }: { ai: JevBinding }): JevClient =>
    async (request) => {
        const response = (await ai.run(JEV_MODEL, request)) as Partial<JevResponse> | null;
        if (!response || typeof response !== "object" || !response.answers) {
            throw new Error("Jev returned no answers");
        }
        return response as JevResponse;
    };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/services/jev-client.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
bun lint
git add src/contracts/jev.ts src/core/services/jev-client.ts tests/core/services/jev-client.test.ts
git commit -m "feat(mcp): add a Jev client over the Workers AI binding"
```

---

### Task 2: Core domain selector

**Files:**
- Create: `src/contracts/core-domain-selector.ts`
- Create: `src/core/services/core-domain-selector.ts`
- Test: `tests/core/services/core-domain-selector.test.ts`

**Interfaces:**
- Consumes: `JevClient`, `JevRequest` (Task 1); `DomainIndex` from `src/contracts/core-schema-domain-splitter.ts`.
- Produces:
  - `type SelectedDomain = { name: string; probability: number }`
  - `type CoreDomainSelector = { select(index: DomainIndex, intent: string): Promise<SelectedDomain[]> }`
  - `const DOMAIN_THRESHOLD = 0.3`, `const MAX_DOMAINS = 4`
  - `buildDomainRequest(index: DomainIndex, intent: string): { request: JevRequest; domainByQuestionId: Map<string, string> }`
  - `scoreDomains(jevClient: JevClient, index: DomainIndex, intent: string): Promise<SelectedDomain[]>`: every answered domain, unsorted, unfiltered (used by the Task 6 eval).
  - `pickDomains(scored: SelectedDomain[], threshold?: number, max?: number): SelectedDomain[]`
  - `createCoreDomainSelector({ jevClient }: { jevClient: JevClient }): CoreDomainSelector`

- [ ] **Step 1: Write the failing test**

`tests/core/services/core-domain-selector.test.ts`:

```ts
import { describe, it, expect, mock } from "bun:test";
import {
    buildDomainRequest,
    createCoreDomainSelector,
    pickDomains,
    scoreDomains,
} from "../../../src/core/services/core-domain-selector";
import type { DomainIndex } from "../../../src/contracts/core-schema-domain-splitter";
import type { JevClient, JevResponse } from "../../../src/contracts/jev";

const index: DomainIndex = {
    domains: [
        { name: "customer", queries: ["customer", "customers"], mutations: ["createCustomer"] },
        { name: "order", queries: ["order", "orders"], mutations: ["createOrder"] },
        { name: "subscription", queries: ["subscription"], mutations: [] },
    ],
};

const answers = (nouls: Record<string, number>): JevResponse => ({
    model: "jev-1.13.0",
    answers: Object.fromEntries(Object.entries(nouls).map(([id, noul]) => [id, { type: "noul", noul }])),
});

describe("buildDomainRequest", () => {
    it("puts the intent and the domain index in state and asks one noul per domain", () => {
        const { request, domainByQuestionId } = buildDomainRequest(index, "create an order");

        expect(request.state).toEqual({ intent: "create an order", domains: index.domains });
        expect(Object.keys(request.questions)).toEqual(["d0", "d1", "d2"]);
        expect(domainByQuestionId.get("d1")).toBe("order");
        expect(request.questions.d1.type).toBe("noul");
        expect(request.questions.d1.instructions).toContain('"order"');
        expect(request.questions.d1.criteria?.true).toContain("order");
    });
});

describe("pickDomains", () => {
    it("keeps domains at or above the threshold, most likely first, capped", () => {
        const picked = pickDomains(
            [
                { name: "a", probability: 0.2 },
                { name: "b", probability: 0.9 },
                { name: "c", probability: 0.3 },
                { name: "d", probability: 0.6 },
            ],
            0.3,
            2,
        );
        expect(picked).toEqual([
            { name: "b", probability: 0.9 },
            { name: "d", probability: 0.6 },
        ]);
    });
});

describe("scoreDomains", () => {
    it("maps answers back to domain names and skips missing answers", async () => {
        const jevClient: JevClient = async () => answers({ d0: 0.4, d1: 0.95 });
        expect(await scoreDomains(jevClient, index, "create an order")).toEqual([
            { name: "customer", probability: 0.4 },
            { name: "order", probability: 0.95 },
        ]);
    });
});

describe("createCoreDomainSelector", () => {
    it("returns the picked domains for an intent", async () => {
        const jevClient: JevClient = async () => answers({ d0: 0.7, d1: 0.95, d2: 0.05 });
        const selector = createCoreDomainSelector({ jevClient });

        expect(await selector.select(index, "create an order for a customer")).toEqual([
            { name: "order", probability: 0.95 },
            { name: "customer", probability: 0.7 },
        ]);
    });

    it("does not call Jev for a blank intent", async () => {
        const jevClient = mock(async () => answers({}));
        const selector = createCoreDomainSelector({ jevClient });

        expect(await selector.select(index, "   ")).toEqual([]);
        expect(jevClient).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/services/core-domain-selector.test.ts`
Expected: FAIL, cannot resolve `../../../src/core/services/core-domain-selector`.

- [ ] **Step 3: Write minimal implementation**

`src/contracts/core-domain-selector.ts`:

```ts
import type { DomainIndex } from "./core-schema-domain-splitter";

export type SelectedDomain = {
    name: string;
    probability: number;
};

export type CoreDomainSelector = {
    select(index: DomainIndex, intent: string): Promise<SelectedDomain[]>;
};
```

`src/core/services/core-domain-selector.ts`:

```ts
import type { CoreDomainSelector, SelectedDomain } from "../../contracts/core-domain-selector";
import type { DomainIndex } from "../../contracts/core-schema-domain-splitter";
import type { JevClient, JevRequest } from "../../contracts/jev";

/**
 * Missing a needed domain costs the agent another round-trip; an extra domain only costs output size.
 * So the threshold leans low and the cap bounds the output.
 */
export const DOMAIN_THRESHOLD = 0.3;
export const MAX_DOMAINS = 4;

/**
 * One Noul per domain over a shared state, sent as a single request (Jev answers them in parallel).
 * Question ids are opaque to the model, so each instruction names its domain in full.
 */
export function buildDomainRequest(
    index: DomainIndex,
    intent: string,
): { request: JevRequest; domainByQuestionId: Map<string, string> } {
    const domainByQuestionId = new Map<string, string>();
    const questions: JevRequest["questions"] = {};
    index.domains.forEach((domain, i) => {
        const id = `d${i}`;
        domainByQuestionId.set(id, domain.name);
        questions[id] = {
            type: "noul",
            instructions:
                `Does accomplishing \`intent\` against the Crystallize Core API require at least one of the ` +
                `queries or mutations listed for the "${domain.name}" domain in \`domains\`?`,
            criteria: {
                true: `At least one "${domain.name}" query or mutation is needed to read or write what the intent is about`,
                false: `The intent can be accomplished without any "${domain.name}" query or mutation`,
            },
        };
    });
    return { request: { state: { intent, domains: index.domains }, questions }, domainByQuestionId };
}

export async function scoreDomains(
    jevClient: JevClient,
    index: DomainIndex,
    intent: string,
): Promise<SelectedDomain[]> {
    const { request, domainByQuestionId } = buildDomainRequest(index, intent);
    const response = await jevClient(request);
    const scored: SelectedDomain[] = [];
    for (const [id, name] of domainByQuestionId) {
        const answer = response.answers[id];
        if (answer) scored.push({ name, probability: answer.noul });
    }
    return scored;
}

export function pickDomains(
    scored: SelectedDomain[],
    threshold = DOMAIN_THRESHOLD,
    max = MAX_DOMAINS,
): SelectedDomain[] {
    return scored
        .filter((d) => d.probability >= threshold)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, max);
}

export const createCoreDomainSelector = ({ jevClient }: { jevClient: JevClient }): CoreDomainSelector => ({
    async select(index, intent) {
        if (!intent.trim()) return [];
        return pickDomains(await scoreDomains(jevClient, index, intent));
    },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/services/core-domain-selector.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
bun lint
git add src/contracts/core-domain-selector.ts src/core/services/core-domain-selector.ts tests/core/services/core-domain-selector.test.ts
git commit -m "feat(mcp): select Core schema domains for an intent with Jev"
```

---

### Task 3: Compact several domains at once

**Files:**
- Modify: `src/contracts/core-schema-domain-splitter.ts:13-20`
- Modify: `src/core/services/core-schema-domain-splitter.ts:123-147`
- Test: `tests/core/services/core-schema-domain-splitter.test.ts` (append to the `createCoreSchemaDomainSplitter` describe)

**Interfaces:**
- Produces: `CoreSchemaDomainSplitter.getCompactedDomainsSchema(introspection: IntrospectionResult, domains: string[], operations: "queries" | "mutations" | "both"): string`. `getCompactedDomainSchema` keeps its signature and delegates to it.

- [ ] **Step 1: Write the failing test**

Append inside `describe("createCoreSchemaDomainSplitter", ...)`, after the `getCompactedDomainSchema` describe:

```ts
    describe("getCompactedDomainsSchema", () => {
        it("returns the union of the requested domains' root fields", () => {
            const schema = splitter.getCompactedDomainsSchema(introspection, ["order", "subscription"], "both");

            expect(schema).toContain("createOrder");
            expect(schema).toContain("Subscription");
            expect(schema).not.toContain("createCustomer");
        });

        it("names every unknown domain", () => {
            const result = splitter.getCompactedDomainsSchema(introspection, ["order", "nope", "nada"], "both");
            expect(result).toContain('Unknown domain "nope", "nada"');
            expect(result).toContain("Available domains:");
        });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/services/core-schema-domain-splitter.test.ts`
Expected: FAIL, `splitter.getCompactedDomainsSchema is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `src/contracts/core-schema-domain-splitter.ts`, add to the `CoreSchemaDomainSplitter` type:

```ts
    getCompactedDomainsSchema(
        introspection: IntrospectionResult,
        domains: string[],
        operations: "queries" | "mutations" | "both",
    ): string;
```

In `src/core/services/core-schema-domain-splitter.ts`, replace the whole `getCompactedDomainSchema` method (lines 123-147) with:

```ts
        getCompactedDomainSchema(
            introspection: IntrospectionResult,
            domain: string,
            operations: "queries" | "mutations" | "both",
        ): string {
            return this.getCompactedDomainsSchema(introspection, [domain], operations);
        },

        getCompactedDomainsSchema(
            introspection: IntrospectionResult,
            domains: string[],
            operations: "queries" | "mutations" | "both",
        ): string {
            const index = this.listDomains(introspection);
            const unknown = domains.filter((name) => !index.domains.some((d) => d.name === name));
            if (unknown.length > 0) {
                const available = index.domains.map((d) => d.name).join(", ");
                return `Unknown domain "${unknown.join('", "')}". Available domains: ${available}`;
            }

            const fieldNames = new Set<string>();
            for (const domainInfo of index.domains.filter((d) => domains.includes(d.name))) {
                if (operations === "queries" || operations === "both") {
                    for (const f of domainInfo.queries) fieldNames.add(f);
                }
                if (operations === "mutations" || operations === "both") {
                    for (const f of domainInfo.mutations) fieldNames.add(f);
                }
            }

            return compactSchemaFromIntrospection(introspection, {
                operations,
                rootFieldFilter: fieldNames,
            });
        },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/services/core-schema-domain-splitter.test.ts`
Expected: PASS, including the existing `returns error for unknown domain` test (message is unchanged for one domain).

- [ ] **Step 5: Commit**

```bash
bun lint
git add src/contracts/core-schema-domain-splitter.ts src/core/services/core-schema-domain-splitter.ts tests/core/services/core-schema-domain-splitter.test.ts
git commit -m "feat(mcp): compact several Core schema domains in one schema"
```

---

### Task 4: `intent` input on `fetch-core-graphql-schema`

**Files:**
- Modify: `src/core/mcp/tools/fetch-core-graphql-schema.ts`
- Test: `tests/core/mcp/tools/fetch-core-graphql-schema.test.ts`

**Interfaces:**
- Consumes: `CoreDomainSelector`, `SelectedDomain` (Task 2); `getCompactedDomainsSchema` (Task 3).
- Produces: tool `Deps` gains `coreDomainSelector: CoreDomainSelector` (Task 5 registers it); input schema gains `intent?: string`.

- [ ] **Step 1: Write the failing test**

`tests/core/mcp/tools/fetch-core-graphql-schema.test.ts`:

```ts
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createFetchCoreGraphqlSchemaToolWrapper } from "../../../../src/core/mcp/tools/fetch-core-graphql-schema";
import { createCoreSchemaDomainSplitter } from "../../../../src/core/services/core-schema-domain-splitter";
import type { CoreDomainSelector } from "../../../../src/contracts/core-domain-selector";
import type { TenantMatcher } from "../../../../src/contracts/tenant-matcher";
import type { AuthContextResolver } from "../../../../src/contracts/auth-context-resolver";
import { buildIntrospectionFromSDL, testAuthContext, testTenants } from "../../../utils/fixtures";

const SDL = `
    type Query {
        order(id: ID!): Order
        customer(id: ID!): Customer
        subscription(id: ID!): Subscription
    }
    type Mutation {
        createOrder(total: Float!): Order!
        createCustomer(name: String!): Customer!
    }
    type Order { id: ID! total: Float! }
    type Customer { id: ID! name: String! }
    type Subscription { id: ID! plan: String! }
`;

const originalFetch = globalThis.fetch;

describe("fetch-core-graphql-schema", () => {
    let select: ReturnType<typeof mock>;
    let tool: ReturnType<typeof createFetchCoreGraphqlSchemaToolWrapper>;

    const run = async (input: { domain?: string; intent?: string }) => {
        const result = await tool.handler({ tenant: "shop", ...input, authContext: testAuthContext });
        return result.content[0].text;
    };

    beforeEach(() => {
        const introspection = buildIntrospectionFromSDL(SDL);
        globalThis.fetch = mock(async () => new Response(JSON.stringify(introspection))) as unknown as typeof fetch;
        select = mock(async () => []);
        tool = createFetchCoreGraphqlSchemaToolWrapper({
            coreSchemaDomainSplitter: createCoreSchemaDomainSplitter(),
            coreDomainSelector: { select } as unknown as CoreDomainSelector,
            tenantMatcher: (() => testTenants[0]) as unknown as TenantMatcher,
            authContextResolver: { getAuthHeaders: () => ({}) } as unknown as AuthContextResolver,
        });
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it("returns the domain index when neither domain nor intent is given", async () => {
        const text = await run({});
        expect(text).toContain("# Core API Schema Domains");
        expect(select).not.toHaveBeenCalled();
    });

    it("returns the schema of every domain the selector picks for an intent", async () => {
        select.mockImplementation(async () => [
            { name: "order", probability: 0.97 },
            { name: "customer", probability: 0.81 },
        ]);
        const text = await run({ intent: "create an order for a customer" });

        expect(select.mock.calls[0][1]).toBe("create an order for a customer");
        expect(text).toContain("order (97%), customer (81%)");
        expect(text).toContain("createOrder");
        expect(text).toContain("createCustomer");
        expect(text).not.toContain("Subscription");
    });

    it("falls back to the index when the selector picks nothing", async () => {
        const text = await run({ intent: "bake a cake" });
        expect(text).toContain("Could not pick domains for this intent");
        expect(text).toContain("# Core API Schema Domains");
    });

    it("falls back to the index when the selector throws", async () => {
        select.mockImplementation(async () => {
            throw new Error("Workers AI is down");
        });
        const text = await run({ intent: "create an order" });
        expect(text).toContain("Could not pick domains for this intent");
        expect(text).not.toContain("Failed to fetch core schema");
    });

    it("treats a blank intent as no intent", async () => {
        const text = await run({ intent: "   " });
        expect(text).toContain("# Core API Schema Domains");
        expect(text).not.toContain("Could not pick domains");
        expect(select).not.toHaveBeenCalled();
    });

    it("prefers an exact domain over an intent", async () => {
        const text = await run({ domain: "subscription", intent: "create an order" });
        expect(text).toContain("Subscription");
        expect(text).not.toContain("createOrder");
        expect(select).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/core/mcp/tools/fetch-core-graphql-schema.test.ts`
Expected: FAIL. The intent tests get the plain index back (no `order (97%)`, no `Could not pick domains`), and `tsc` would flag the unknown `coreDomainSelector` dep.

- [ ] **Step 3: Write minimal implementation**

In `src/core/mcp/tools/fetch-core-graphql-schema.ts`:

1. Add imports and the dep:

```ts
import type { CoreDomainSelector, SelectedDomain } from "../../../contracts/core-domain-selector";
```

```ts
type Deps = {
    coreSchemaDomainSplitter: CoreSchemaDomainSplitter;
    coreDomainSelector: CoreDomainSelector;
    tenantMatcher: TenantMatcher;
    authContextResolver: AuthContextResolver;
};
```

2. Add below `formatDomainIndex`:

```ts
function formatSelectionHeader(selected: SelectedDomain[]): string {
    const picked = selected.map((d) => `${d.name} (${Math.round(d.probability * 100)}%)`).join(", ");
    return (
        `# Core API schema for: ${selected.map((d) => d.name).join(", ")}\n\n` +
        `Domains picked for your intent: ${picked}. If something is missing, call again with \`domain\` ` +
        "set to the one you need, or with neither `intent` nor `domain` for the full list.\n\n"
    );
}

const NO_SELECTION_NOTE =
    "Could not pick domains for this intent automatically. Call again with `domain` set to one of the following.\n\n";
```

3. Replace the factory's destructuring, `description`, `inputSchema` and `handler` with:

```ts
export const createFetchCoreGraphqlSchemaToolWrapper = ({
    coreSchemaDomainSplitter,
    coreDomainSelector,
    tenantMatcher,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Core API (aka Core Next) for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "The Core API schema is large, so it is split into domains. Prefer passing `intent`: a one-sentence " +
            "description of what you want to do (e.g. 'create an order for an existing customer'); the server " +
            "then returns the schema of every domain that task needs, in one call. " +
            "Pass `domain` instead when you already know the exact domain. " +
            "Common domains: order, customer, subscription, subscriptionPlan, pricelist, pipeline, flow, app, user, webhook, stockLocation, invite. " +
            "Call with neither to get the full list of domains. " +
            "The Core API is the admin API — use it for orders, customers, price lists, users, subscriptions, " +
            "subscription plans, pipelines, flows, apps, and other back-office/admin resources. " +
            "Do NOT use this for fetching items or products for storefronts — use Catalogue or Discovery APIs instead.",
        inputSchema: z.object({
            tenant: tenantSchema,
            domain: z
                .string()
                .optional()
                .describe(
                    "The exact domain to fetch the schema for (e.g. 'order', 'customer', 'subscription'). " +
                        "Takes precedence over `intent`.",
                ),
            intent: z
                .string()
                .max(1000)
                .optional()
                .describe(
                    "What you want to do with the Core API, in one sentence " +
                        "(e.g. 'list the orders of a customer and their subscriptions'). " +
                        "The server picks the relevant domains and returns their combined schema.",
                ),
        }),
        annotations: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, domain, intent, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = buildAtApiUrl("https://api.crystallize.com", matchedTenant.identifier, "");
            const headers: Record<string, string> = authContextResolver.getAuthHeaders(authContext);
            const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
            try {
                const introspection = await fetchIntrospection(url, headers);
                const index = coreSchemaDomainSplitter.listDomains(introspection);

                if (domain) {
                    if (!index.domains.some((d) => d.name === domain)) {
                        return text(`Unknown domain "${domain}". Here are the available domains:\n\n${formatDomainIndex(index)}`);
                    }
                    return text(coreSchemaDomainSplitter.getCompactedDomainSchema(introspection, domain, "both"));
                }

                if (intent?.trim()) {
                    let selected: SelectedDomain[] = [];
                    try {
                        selected = await coreDomainSelector.select(index, intent);
                    } catch (error) {
                        // Selection is an optimization: when Jev is unavailable, the index still works.
                        console.warn(`Core domain selection failed: ${sanitizeErrorMessage(error)}`);
                    }
                    if (selected.length === 0) {
                        return text(NO_SELECTION_NOTE + formatDomainIndex(index));
                    }
                    const schema = coreSchemaDomainSplitter.getCompactedDomainsSchema(
                        introspection,
                        selected.map((d) => d.name),
                        "both",
                    );
                    return text(formatSelectionHeader(selected) + schema);
                }

                return text(formatDomainIndex(index));
            } catch (error) {
                return text(`Failed to fetch core schema: ${sanitizeErrorMessage(error)}`);
            }
        },
    });
};
```

Wrap the `Unknown domain` line if `bun lint` or the 120-char rule complains.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/core/mcp/tools/fetch-core-graphql-schema.test.ts`
Expected: PASS (6 tests). Then run `bun test` for the whole suite: all green.

- [ ] **Step 5: Commit**

```bash
bun lint
git add src/core/mcp/tools/fetch-core-graphql-schema.ts tests/core/mcp/tools/fetch-core-graphql-schema.test.ts
git commit -m "feat(mcp): accept an intent on fetch-core-graphql-schema"
```

---

### Task 5: Wire the Workers AI binding and the services

**Files:**
- Modify: `wrangler.jsonc` (add `ai` binding)
- Modify: `worker-configuration.d.ts` (regenerated, do not hand-edit)
- Modify: `src/core/container.ts`
- Modify: `CLAUDE.md` (container registrations, tool table, platform bindings)

**Interfaces:**
- Consumes: `createJevClient`, `JevBinding` (Task 1); `createCoreDomainSelector` (Task 2); tool `Deps.coreDomainSelector` (Task 4).
- Produces: container keys `ai`, `jevClient`, `coreDomainSelector`.

- [ ] **Step 1: Add the binding**

In `wrangler.jsonc`, after the `"placement"` block, add:

```jsonc
    // Workers AI, for TypeSafe's Jev model (typesafe/jev): picks Core schema domains for an intent.
    "ai": {
        "binding": "AI",
    },
```

- [ ] **Step 2: Regenerate the bindings type**

Run: `bun cf-typegen`
Expected: `worker-configuration.d.ts` now has `AI: Ai;` in `interface Env`.

- [ ] **Step 3: Register the services**

In `src/core/container.ts`:

```ts
import { asFunction, asValue, createContainer, InferCradleFromContainer, InjectionMode } from "awilix";
```

```ts
import { createJevClient, type JevBinding } from "./services/jev-client";
import { createCoreDomainSelector } from "./services/core-domain-selector";
```

Change `const build = () =>` to `const build = (env: CloudflareBindings) =>` and add to the services block, after `coreSchemaDomainSplitter`:

```ts
        // Bindings are fixed for the isolate's lifetime, unlike request-derived values, so the
        // cached container can hold them. The cast: the generated `Ai` types predate typesafe/jev.
        ai: asValue(env.AI as unknown as JevBinding),
        jevClient: asFunction(createJevClient).singleton(),
        coreDomainSelector: asFunction(createCoreDomainSelector).singleton(),
```

Replace the `buildContainer` line with:

```ts
export const buildContainer = (env: CloudflareBindings) => (container ??= build(env));
```

- [ ] **Step 4: Update CLAUDE.md**

- Under **Services** (singletons), add after `coreSchemaDomainSplitter`:
  - `` `ai` — the Workers AI binding (`env.AI`), held by the cached container because bindings are isolate-stable ``
  - `` `jevClient` — runs TypeSafe's Jev (`typesafe/jev`) on Workers AI `` 
  - `` `coreDomainSelector` — picks the Core schema domains an `intent` needs (one Jev Noul per domain; falls back to the index on failure) ``
- In the Tool Registry table, change the `fetch-core-graphql-schema` purpose to `Get compacted Core schema (by domain or intent)`.
- Under **Platform**, add: `` **Bindings**: `AI` (Workers AI; used for `typesafe/jev`). Local dev calls the remote model, so `wrangler login` is needed for intent selection; without it the tool falls back to the domain index. ``
- In the project-structure tree, add `jev.ts`, `core-domain-selector.ts` under `contracts/` and `jev-client.ts`, `core-domain-selector.ts` under `services/`, one-line comments each.

- [ ] **Step 5: Verify**

Run: `bun type-check && bun test && bun lint`
Expected: no type errors (the known `@ts-expect-error` in `services-provider.ts` stays used), all tests pass, lint clean.

Run: `bun run build`
Expected: build succeeds and `dist/crystallize_mcp_server/wrangler.json` contains `"ai": { "binding": "AI" }`.

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc worker-configuration.d.ts src/core/container.ts CLAUDE.md
git commit -m "feat(mcp): bind Workers AI and register the Jev domain selector"
```

---

### Task 6: Evaluate against real Jev and tune the threshold

**Files:**
- Create: `bin/eval-domain-selection.ts`
- Create: `bin/eval-domain-selection.cases.json`

**Interfaces:**
- Consumes: `scoreDomains`, `pickDomains`, `MAX_DOMAINS` (Task 2); `createCoreSchemaDomainSplitter`; `fetchIntrospection`; `buildAtApiUrl`; `JevClient` (Task 1).

This needs real credentials. Ask the user for them; never commit them. Required env: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (Workers AI permission), `CRYSTALLIZE_TENANT`, `CRYSTALLIZE_TOKEN_ID`, `CRYSTALLIZE_TOKEN_SECRET`.

- [ ] **Step 1: Write the cases**

`bin/eval-domain-selection.cases.json`, with each `expected` listing the domains the intent truly needs:

```json
[
    { "intent": "list the last 10 orders", "expected": ["order"] },
    { "intent": "create an order for an existing customer", "expected": ["order", "customer"] },
    { "intent": "find a customer by email and show their subscriptions", "expected": ["customer", "subscription"] },
    { "intent": "create a monthly subscription plan with a 14 day trial", "expected": ["subscriptionPlan"] },
    { "intent": "add a price list with 20% off for B2B customers", "expected": ["pricelist"] },
    { "intent": "move an order to the shipped stage of the fulfilment pipeline", "expected": ["pipeline", "order"] },
    { "intent": "set up a webhook that fires when an order is created", "expected": ["webhook"] },
    { "intent": "invite a new colleague to the tenant as an admin", "expected": ["invite"] },
    { "intent": "list all users and their roles", "expected": ["user"] },
    { "intent": "create a new warehouse for stock", "expected": ["stockLocation"] },
    { "intent": "cancel a customer's subscription", "expected": ["subscription"] },
    { "intent": "install an app on the tenant", "expected": ["app"] }
]
```

- [ ] **Step 2: Write the script**

`bin/eval-domain-selection.ts`:

```ts
import { readFileSync } from "node:fs";
import type { JevClient, JevResponse } from "../src/contracts/jev";
import { JEV_MODEL } from "../src/core/services/jev-client";
import { MAX_DOMAINS, pickDomains, scoreDomains } from "../src/core/services/core-domain-selector";
import { createCoreSchemaDomainSplitter } from "../src/core/services/core-schema-domain-splitter";
import { fetchIntrospection } from "../src/core/services/compact-schema-builder";
import { buildAtApiUrl } from "../src/core/security";

const env = (name: string) => {
    const value = process.env[name];
    if (!value) {
        console.error(`Missing env var ${name}`);
        process.exit(1);
    }
    return value;
};

const accountId = env("CLOUDFLARE_ACCOUNT_ID");
const apiToken = env("CLOUDFLARE_API_TOKEN");

// Same request shape as the binding, over the REST API, so the eval runs outside a Worker.
const jevClient: JevClient = async (request) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: JEV_MODEL, input: request }),
    });
    const json = (await response.json()) as { success: boolean; result: JevResponse; errors?: unknown };
    if (!json.success) throw new Error(`Workers AI error: ${JSON.stringify(json.errors)}`);
    return json.result;
};

const url = buildAtApiUrl("https://api.crystallize.com", env("CRYSTALLIZE_TENANT"), "");
const introspection = await fetchIntrospection(url, {
    "X-Crystallize-Access-Token-Id": env("CRYSTALLIZE_TOKEN_ID"),
    "X-Crystallize-Access-Token-Secret": env("CRYSTALLIZE_TOKEN_SECRET"),
});
const index = createCoreSchemaDomainSplitter().listDomains(introspection);
const names = new Set(index.domains.map((d) => d.name));
console.log(`${index.domains.length} domains: ${[...names].join(", ")}\n`);

const cases = JSON.parse(readFileSync(new URL("./eval-domain-selection.cases.json", import.meta.url), "utf-8")) as {
    intent: string;
    expected: string[];
}[];

const THRESHOLDS = [0.2, 0.3, 0.5];
const totals = new Map(THRESHOLDS.map((t) => [t, { fullRecall: 0, returned: 0 }]));

for (const c of cases) {
    const missingFromIndex = c.expected.filter((e) => !names.has(e));
    if (missingFromIndex.length > 0) console.warn(`! case expects unknown domains: ${missingFromIndex.join(", ")}`);

    const scored = await scoreDomains(jevClient, index, c.intent);
    const top = [...scored].sort((a, b) => b.probability - a.probability).slice(0, 6);
    console.log(`- ${c.intent}\n  expected: ${c.expected.join(", ")}`);
    console.log(`  top: ${top.map((d) => `${d.name} ${d.probability.toFixed(2)}`).join(", ")}`);

    for (const t of THRESHOLDS) {
        const picked = pickDomains(scored, t, MAX_DOMAINS).map((d) => d.name);
        const totalsForT = totals.get(t)!;
        if (c.expected.every((e) => picked.includes(e))) totalsForT.fullRecall++;
        totalsForT.returned += picked.length;
    }
}

console.log("\nthreshold  full-recall  avg-domains-returned");
for (const [t, { fullRecall, returned }] of totals) {
    console.log(`${t.toFixed(2)}       ${fullRecall}/${cases.length}         ${(returned / cases.length).toFixed(2)}`);
}
```

- [ ] **Step 3: Run it**

Run (the user provides the values):

```bash
CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… CRYSTALLIZE_TENANT=… \
CRYSTALLIZE_TOKEN_ID=… CRYSTALLIZE_TOKEN_SECRET=… bun run bin/eval-domain-selection.ts
```

Expected: the domain list prints first. Fix any case whose `expected` names are not in it (the `!` warnings), then rerun. Then a per-case block and the threshold table.

- [ ] **Step 4: Tune**

Pick the highest threshold whose full-recall equals the best full-recall in the table (fewest extra domains without losing needed ones). If it differs from `0.3`, update `DOMAIN_THRESHOLD` in `src/core/services/core-domain-selector.ts` and the value in this plan's Global Constraints. If full-recall is below 10/12 at every threshold, stop and report the failing cases to the user; the fix is in the question wording or domain naming, not the threshold.

Also note one Jev response's input-token usage for the prompt, to confirm it sits well under the 32k context (log `(await jevClient(...)).usage` once if needed).

- [ ] **Step 5: Commit**

```bash
bun lint && bun test
git add bin/eval-domain-selection.ts bin/eval-domain-selection.cases.json src/core/services/core-domain-selector.ts
git commit -m "chore(mcp): add a Jev domain-selection eval and tune the threshold"
```

---

## Out of scope (follow-ups)

- **Skills reference selection with Jev** (a `task` input on the `skills` tool picking which `references/*.md` to return). Separate plan once this one ships.
- **Caching Core introspection** (fetched live on every call today).
- **Splitting the Catalogue/Discovery/Shop schemas.**
