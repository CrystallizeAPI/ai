import { describe, it, expect } from "bun:test";
import { buildIntrospectionFromSDL } from "../../utils/fixtures";
import type { IntrospectionResult } from "../../../src/core/services/compact-schema-builder";
import { createCoreSchemaDomainSplitter, inferDomain } from "../../../src/core/services/core-schema-domain-splitter";

describe("inferDomain", () => {
    it("strips verb prefixes and returns lowercase stem", () => {
        expect(inferDomain("createOrder")).toBe("order");
        expect(inferDomain("updateOrder")).toBe("order");
        expect(inferDomain("deleteOrder")).toBe("order");
        expect(inferDomain("getOrder")).toBe("order");
    });

    it("singularizes plural stems", () => {
        expect(inferDomain("orders")).toBe("order");
        expect(inferDomain("listOrders")).toBe("order");
        expect(inferDomain("getCategories")).toBe("category");
    });

    it("handles fields without verb prefix", () => {
        expect(inferDomain("order")).toBe("order");
        expect(inferDomain("customer")).toBe("customer");
    });

    it("handles 'search' prefix", () => {
        expect(inferDomain("searchCustomers")).toBe("customer");
    });

    it("handles 'publish/unpublish' prefixes", () => {
        expect(inferDomain("publishItem")).toBe("item");
        expect(inferDomain("unpublishItem")).toBe("item");
    });

    it("handles 'bulk' prefix", () => {
        expect(inferDomain("bulkCreateOrders")).toBe("createOrder");
    });

    it("lowercases first character of stem", () => {
        expect(inferDomain("Subscription")).toBe("subscription");
    });
});

const MULTI_DOMAIN_SDL = `
    type Query {
        order(id: ID!): Order
        orders: [Order!]!
        customer(id: ID!): Customer
        customers: [Customer!]!
        subscription(id: ID!): Subscription
    }
    type Mutation {
        createOrder(input: OrderInput!): Order!
        updateOrder(id: ID!, input: OrderInput!): Order!
        createCustomer(name: String!): Customer!
    }
    type Order {
        id: ID!
        total: Float!
        customer: Customer
    }
    type Customer {
        id: ID!
        name: String!
        orders: [Order!]!
    }
    type Subscription {
        id: ID!
        plan: String!
    }
    input OrderInput {
        total: Float!
    }
`;

describe("createCoreSchemaDomainSplitter", () => {
    const introspection = buildIntrospectionFromSDL(MULTI_DOMAIN_SDL) as unknown as IntrospectionResult;
    const splitter = createCoreSchemaDomainSplitter();

    describe("listDomains", () => {
        it("groups root fields into domains", () => {
            const index = splitter.listDomains(introspection);
            const domainNames = index.domains.map((d) => d.name);

            expect(domainNames).toContain("order");
            expect(domainNames).toContain("customer");
            expect(domainNames).toContain("subscription");
        });

        it("assigns queries and mutations to correct domains", () => {
            const index = splitter.listDomains(introspection);
            const orderDomain = index.domains.find((d) => d.name === "order");

            expect(orderDomain).toBeDefined();
            expect(orderDomain!.queries).toContain("order");
            expect(orderDomain!.queries).toContain("orders");
            expect(orderDomain!.mutations).toContain("createOrder");
            expect(orderDomain!.mutations).toContain("updateOrder");
        });

        it("returns sorted domain names", () => {
            const index = splitter.listDomains(introspection);
            const names = index.domains.map((d) => d.name);
            expect(names).toEqual([...names].sort());
        });
    });

    describe("getCompactedDomainSchema", () => {
        it("returns only the requested domain's schema", () => {
            const schema = splitter.getCompactedDomainSchema(introspection, "order", "both");

            expect(schema).toContain("# Queries");
            expect(schema).toContain("# Mutations");
            expect(schema).toContain("Order");
            expect(schema).toContain("createOrder");
            // Customer is reachable from Order.customer, so it should be included as a type
            expect(schema).toContain("Customer");
            // But Subscription should NOT be included
            expect(schema).not.toContain("Subscription");
        });

        it("returns error for unknown domain", () => {
            const result = splitter.getCompactedDomainSchema(introspection, "nonexistent", "both");
            expect(result).toContain("Unknown domain");
            expect(result).toContain("nonexistent");
        });

        it("filters to queries only for a domain", () => {
            const schema = splitter.getCompactedDomainSchema(introspection, "order", "queries");
            expect(schema).toContain("# Queries");
            expect(schema).not.toContain("# Mutations");
        });

        it("filters to mutations only for a domain", () => {
            const schema = splitter.getCompactedDomainSchema(introspection, "order", "mutations");
            expect(schema).not.toContain("# Queries");
            expect(schema).toContain("# Mutations");
        });

        it("returns schema for a domain with only queries", () => {
            const schema = splitter.getCompactedDomainSchema(introspection, "subscription", "both");
            expect(schema).toContain("Subscription");
            expect(schema).not.toContain("# Mutations");
        });
    });
});
