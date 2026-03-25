import { describe, it, expect, mock, beforeEach } from "bun:test";
import { buildIntrospectionFromSDL } from "../../utils/fixtures";

const mockFetchIntrospection = mock();
mock.module("../../../src/core/services/compact-schema-builder", () => ({
    fetchIntrospection: mockFetchIntrospection,
}));

import { createGraphqlQueryCorrector } from "../../../src/core/services/graphql-query-corrector";

const SCHEMA_SDL = `
    type Query {
        products(language: String, limit: Int): [Product!]!
        orders(customerId: String): [Order!]!
    }
    type Product {
        name: String!
        price: Float!
        description: String
        variants: [Variant!]!
    }
    type Variant {
        sku: String!
        stock: Int!
    }
    type Order {
        id: ID!
        total: Float!
        status: String!
    }
`;

describe("graphqlQueryCorrector", () => {
    const corrector = createGraphqlQueryCorrector();
    const url = "https://api.example.com/graphql";
    const headers = {};

    beforeEach(() => {
        const introspection = buildIntrospectionFromSDL(SCHEMA_SDL);
        mockFetchIntrospection.mockReset();
        mockFetchIntrospection.mockResolvedValue(introspection as never);
    });

    it("returns null for a valid query", async () => {
        const result = await corrector("{ products { name price } }", url, headers);
        expect(result).toBeNull();
    });

    it("returns null for an unparseable query", async () => {
        const result = await corrector("{ invalid {{{{", url, headers);
        expect(result).toBeNull();
    });

    it("corrects a misspelled field via Levenshtein", async () => {
        const result = await corrector("{ products { nme price } }", url, headers);
        expect(result).not.toBeNull();
        expect(result!.corrections).toHaveLength(1);
        expect(result!.corrections[0]).toMatchObject({
            field: "nme",
            parentType: "Product",
            suggestion: "name",
            kind: "unknown-field",
        });
        expect(result!.correctedQuery).toContain("name");
        expect(result!.correctedQuery).not.toContain("nme");
    });

    it("corrects an unknown argument via Levenshtein", async () => {
        const result = await corrector('{ products(lang: "en") { name } }', url, headers);
        expect(result).not.toBeNull();
        expect(result!.corrections).toHaveLength(1);
        expect(result!.corrections[0]).toMatchObject({
            field: "lang",
            parentType: "Query.products",
            suggestion: "language",
            kind: "unknown-argument",
        });
        expect(result!.correctedQuery).toContain("language");
    });

    it("returns non-correctable errors for unresolvable issues", async () => {
        // Use a fragment spread referencing a non-existent fragment
        const query = "{ products { ...ProductFields } }";
        const result = await corrector(query, url, headers);
        expect(result).not.toBeNull();
        expect(result!.corrections).toHaveLength(0);
        expect(result!.errors.length).toBeGreaterThan(0);
    });

    it("applies multiple corrections preserving offsets", async () => {
        const result = await corrector("{ products { nme pric } }", url, headers);
        expect(result).not.toBeNull();
        expect(result!.corrections).toHaveLength(2);
        expect(result!.correctedQuery).toContain("name");
        expect(result!.correctedQuery).toContain("price");
        expect(result!.correctedQuery).not.toContain("nme");
        // "pric" is a substring of "price", so check via regex for standalone word
        expect(result!.correctedQuery).not.toMatch(/\bpric\b/);
    });
});
