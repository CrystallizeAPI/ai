import { describe, it, expect, mock, beforeEach } from "bun:test";

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

    const run = async (input: { domain?: string; intent?: string }) => {
        const result = await tool.handler({ tenant: "shop", ...input, authContext: testAuthContext });
        return result.content[0].text;
    };

    beforeEach(() => {
        mockFetchIntrospection.mockImplementation(async () => buildIntrospectionFromSDL(SDL));
        select = mock(async () => []);
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
