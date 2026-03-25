import { describe, it, expect, mock, beforeEach } from "bun:test";
import { buildIntrospectionFromSDL } from "../../utils/fixtures";

const mockFetchIntrospection = mock();
mock.module("../../../src/core/services/compact-schema-builder", () => {
    const actual = require("../../../src/core/services/compact-schema-builder");
    return {
        ...actual,
        fetchIntrospection: mockFetchIntrospection,
    };
});

import {
    createGraphlSchemaCompacter,
    compactSchemaFromIntrospection,
} from "../../../src/core/services/compact-schema-builder";

const SCHEMA_SDL = `
    type Query {
        products: [Product!]!
        categories: [Category!]!
    }
    type Mutation {
        createProduct(name: String!): Product!
    }
    type Product {
        id: ID!
        name: String!
        price: Float!
        category: Category
    }
    type Category {
        id: ID!
        name: String!
        products: [Product!]!
    }
    enum SortOrder {
        ASC
        DESC
    }
    input ProductFilter {
        name: String
        minPrice: Float
    }
    type Unreachable {
        data: String
    }
`;

describe("compactSchemaBuilder", () => {
    beforeEach(() => {
        const introspection = buildIntrospectionFromSDL(SCHEMA_SDL);
        mockFetchIntrospection.mockReset();
        mockFetchIntrospection.mockResolvedValue(introspection);
    });

    it("produces output containing Queries and Types sections", async () => {
        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql");

        expect(result).toContain("# Queries");
        expect(result).toContain("# Types");
        expect(result).toContain("products");
        expect(result).toContain("Product");
    });

    it("includes Mutations section when operations is 'both'", async () => {
        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "both" });

        expect(result).toContain("# Queries");
        expect(result).toContain("# Mutations");
        expect(result).toContain("createProduct");
    });

    it("filters to queries only", async () => {
        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "queries" });

        expect(result).toContain("# Queries");
        expect(result).not.toContain("# Mutations");
    });

    it("filters to mutations only", async () => {
        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "mutations" });

        expect(result).not.toContain("# Queries");
        expect(result).toContain("# Mutations");
    });

    it("excludes unreachable types", async () => {
        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql");

        expect(result).not.toContain("Unreachable");
    });

    it("includes enum types", async () => {
        const sdl = `
            type Query {
                products(sort: SortOrder): [Product!]!
            }
            type Product {
                name: String!
            }
            enum SortOrder {
                ASC
                DESC
            }
        `;
        const introspection = buildIntrospectionFromSDL(sdl);
        mockFetchIntrospection.mockReset();
        mockFetchIntrospection.mockResolvedValue(introspection);

        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql");

        expect(result).toContain("# Enums");
        expect(result).toContain("SortOrder");
        expect(result).toContain("ASC");
        expect(result).toContain("DESC");
    });

    it("deduplicates interface fields in implementing types", async () => {
        const sdl = `
            type Query {
                nodes: [Node!]!
            }
            interface Node {
                id: ID!
                createdAt: String!
            }
            type Product implements Node {
                id: ID!
                createdAt: String!
                name: String!
            }
            type Category implements Node {
                id: ID!
                createdAt: String!
                title: String!
            }
        `;
        const introspection = buildIntrospectionFromSDL(sdl);
        mockFetchIntrospection.mockReset();
        mockFetchIntrospection.mockResolvedValue(introspection);

        const compacter = createGraphlSchemaCompacter();
        const result = await compacter("https://api.example.com/graphql");

        const productLine = result.split("\n").find((line: string) => line.startsWith("Product:"));
        expect(productLine).toBeDefined();
        expect(productLine).toContain("name");
        expect(productLine).not.toContain("id:");
        expect(productLine).not.toContain("createdAt");
    });

    it("throws on failed introspection", async () => {
        mockFetchIntrospection.mockRejectedValue(new Error("Introspection failed: 500 Internal Server Error"));

        const compacter = createGraphlSchemaCompacter();
        await expect(compacter("https://api.example.com/graphql")).rejects.toThrow("Introspection failed");
    });

    it("filters root fields with rootFieldFilter via compactSchemaFromIntrospection", () => {
        const introspection = buildIntrospectionFromSDL(SCHEMA_SDL) as any;
        const result = compactSchemaFromIntrospection(introspection, {
            operations: "both",
            rootFieldFilter: new Set(["products"]),
        });

        expect(result).toContain("# Queries");
        expect(result).toContain("products");
        expect(result).toContain("Product");
        // categories is filtered out since it's not in the rootFieldFilter
        expect(result).not.toContain("categories");
        // createProduct mutation is also filtered out
        expect(result).not.toContain("createProduct");
    });
});
