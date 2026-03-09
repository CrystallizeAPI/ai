import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildIntrospectionFromSDL } from "../../utils/fixtures";

// Use full path for dynamic import
const COMPACT_SCHEMA_BUILDER_PATH = "../../../src/core/services/compact-schema-builder";

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
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        const introspection = buildIntrospectionFromSDL(SCHEMA_SDL);
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(introspection),
            }),
        );
    });

    afterEach(() => {
        vi.stubGlobal("fetch", originalFetch);
    });

    // Import after mock setup
    async function getCompacter() {
        const { createGraphlSchemaCompacter } = await import(COMPACT_SCHEMA_BUILDER_PATH);
        return createGraphlSchemaCompacter();
    }

    it("produces output containing Queries and Types sections", async () => {
        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql");

        expect(result).toContain("# Queries");
        expect(result).toContain("# Types");
        expect(result).toContain("products");
        expect(result).toContain("Product");
    });

    it("includes Mutations section when operations is 'both'", async () => {
        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "both" });

        expect(result).toContain("# Queries");
        expect(result).toContain("# Mutations");
        expect(result).toContain("createProduct");
    });

    it("filters to queries only", async () => {
        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "queries" });

        expect(result).toContain("# Queries");
        expect(result).not.toContain("# Mutations");
    });

    it("filters to mutations only", async () => {
        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql", { operations: "mutations" });

        expect(result).not.toContain("# Queries");
        expect(result).toContain("# Mutations");
    });

    it("excludes unreachable types", async () => {
        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql");

        expect(result).not.toContain("Unreachable");
    });

    it("includes enum types", async () => {
        // SortOrder is not reachable from any root query/mutation in this schema,
        // so it should be excluded. Let's verify enums work with a reachable one.
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
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(introspection),
            }),
        );

        const compacter = await getCompacter();
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
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve(introspection),
            }),
        );

        const compacter = await getCompacter();
        const result = await compacter("https://api.example.com/graphql");

        // The Product type line should contain "name" but not "id" or "createdAt"
        // since those are inherited from Node interface
        const productLine = result.split("\n").find((line: string) => line.startsWith("Product:"));
        expect(productLine).toBeDefined();
        expect(productLine).toContain("name");
        // id and createdAt should NOT appear on the Product line (inherited from Node)
        expect(productLine).not.toContain("id:");
        expect(productLine).not.toContain("createdAt");
    });

    it("throws on failed introspection", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: false,
                status: 500,
                statusText: "Internal Server Error",
            }),
        );

        const compacter = await getCompacter();
        await expect(compacter("https://api.example.com/graphql")).rejects.toThrow("Introspection failed");
    });
});
