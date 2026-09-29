import { describe, it, expect, mock, beforeEach, spyOn } from "bun:test";

// Module-level, like the other schema tests: Bun's mock.module is process-wide, so stubbing
// globalThis.fetch would be bypassed whenever another file's module mock is still in place.
const mockFetchIntrospection = mock();
mock.module("../../../../src/core/services/compact-schema-builder", () => {
    const actual = require("../../../../src/core/services/compact-schema-builder");
    return { ...actual, fetchIntrospection: mockFetchIntrospection };
});

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

describe("fetch-core-graphql-schema", () => {
    let select: ReturnType<typeof mock>;
    let tool: ReturnType<typeof createFetchCoreGraphqlSchemaToolWrapper>;

    const call = (input: { domain?: string; intent?: string }) =>
        tool.handler({ tenant: "shop", ...input, authContext: testAuthContext });
    const run = async (input: { domain?: string; intent?: string }) => (await call(input)).content[0].text;
    const eventPaths = async (input: { domain?: string; intent?: string }) =>
        ((await call(input)).events ?? []).map((e) => e.path);

    beforeEach(() => {
        mockFetchIntrospection.mockImplementation(async () => buildIntrospectionFromSDL(SDL));
        select = mock(async () => ({ picked: [], qualified: 0 }));
        tool = createFetchCoreGraphqlSchemaToolWrapper({
            coreSchemaDomainSplitter: createCoreSchemaDomainSplitter(),
            coreDomainSelector: { select } as unknown as CoreDomainSelector,
            tenantMatcher: (() => testTenants[0]) as unknown as TenantMatcher,
            authContextResolver: { getAuthHeaders: () => ({}) } as unknown as AuthContextResolver,
        });
    });

    it("returns the domain index when neither domain nor intent is given", async () => {
        const text = await run({});
        expect(text).toContain("# Core API Schema Domains");
        expect(select).not.toHaveBeenCalled();
    });

    it("returns the schema of every domain the selector picks for an intent", async () => {
        select.mockImplementation(async () => ({
            picked: [
                { name: "order", probability: 0.97 },
                { name: "customer", probability: 0.81 },
            ],
            qualified: 2,
        }));
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

    describe("selection telemetry", () => {
        it("reports how many domains were picked", async () => {
            select.mockImplementation(async () => ({ picked: [{ name: "order", probability: 0.9 }], qualified: 1 }));
            expect(await eventPaths({ intent: "list orders" })).toEqual(["/jev/fetch-core-graphql-schema/picked-1"]);
        });

        it("reports capped when the cap dropped a qualifying domain", async () => {
            select.mockImplementation(async () => ({ picked: [{ name: "order", probability: 0.9 }], qualified: 5 }));
            expect(await eventPaths({ intent: "everything" })).toEqual(["/jev/fetch-core-graphql-schema/capped"]);
        });

        it("reports none and failed", async () => {
            expect(await eventPaths({ intent: "bake a cake" })).toEqual(["/jev/fetch-core-graphql-schema/none"]);
            select.mockImplementation(async () => {
                throw new Error("down");
            });
            expect(await eventPaths({ intent: "list orders" })).toEqual(["/jev/fetch-core-graphql-schema/failed"]);
        });

        it("sends nothing when Jev was not asked", async () => {
            expect(await eventPaths({})).toEqual([]);
            expect(await eventPaths({ domain: "order", intent: "list orders" })).toEqual([]);
        });

        it("logs the picks and scores as one JSON line, without the intent text", async () => {
            const log = spyOn(console, "log").mockImplementation(() => {});
            select.mockImplementation(async () => ({ picked: [{ name: "order", probability: 0.97 }], qualified: 1 }));
            await run({ intent: "secret customer plan" });
            const line = JSON.parse(log.mock.calls.at(-1)![0] as string);
            log.mockRestore();

            expect(line).toMatchObject({
                event: "jev_selection",
                tool: "fetch-core-graphql-schema",
                outcome: "picked-1",
                candidates: 3,
                qualified: 1,
                picked: [{ name: "order", probability: 0.97 }],
            });
            expect(typeof line.ms).toBe("number");
            expect(JSON.stringify(line)).not.toContain("secret");
        });
    });

    it("prefers an exact domain over an intent", async () => {
        const text = await run({ domain: "subscription", intent: "create an order" });
        expect(text).toContain("Subscription");
        expect(text).not.toContain("createOrder");
        expect(select).not.toHaveBeenCalled();
    });
});
