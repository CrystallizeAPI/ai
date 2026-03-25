import { describe, it, expect, mock } from "bun:test";
import { createQueryExecutor } from "../../../src/core/services/query-with-correction";
import type { GraphqlQueryCorrector, CorrectionResult } from "../../../src/contracts/graphql-query-corrector";

describe("queryExecutor", () => {
    const introspectionUrl = "https://api.example.com/graphql";
    const introspectionHeaders = { Authorization: "Bearer test" };

    function setup() {
        const graphqlQueryCorrector = mock() as unknown as ReturnType<typeof mock> & GraphqlQueryCorrector;
        const queryExecutor = createQueryExecutor({ graphqlQueryCorrector });
        const executor = mock() as unknown as ReturnType<typeof mock> &
            ((query: string, variables?: Record<string, unknown>) => Promise<unknown>);
        return { graphqlQueryCorrector, queryExecutor, executor };
    }

    it("returns JSON data on successful query", async () => {
        const { queryExecutor, executor, graphqlQueryCorrector } = setup();
        executor.mockResolvedValue({ products: [{ name: "Shoe" }] });

        const result = await queryExecutor({
            executor,
            query: "{ products { name } }",
            introspectionUrl,
            introspectionHeaders,
        });

        expect(result.content[0].text).toBe(JSON.stringify({ products: [{ name: "Shoe" }] }, null, 2));
        expect(graphqlQueryCorrector).not.toHaveBeenCalled();
    });

    it("retries with corrected query when corrections available", async () => {
        const { queryExecutor, executor, graphqlQueryCorrector } = setup();
        executor.mockRejectedValueOnce(new Error("Cannot query field"));
        executor.mockResolvedValueOnce({ products: [{ name: "Hat" }] });

        const correction: CorrectionResult = {
            correctedQuery: "{ products { name } }",
            corrections: [{ field: "nme", parentType: "Product", suggestion: "name", kind: "unknown-field" }],
            errors: [],
        };
        graphqlQueryCorrector.mockResolvedValue(correction);

        const result = await queryExecutor({
            executor,
            query: "{ products { nme } }",
            introspectionUrl,
            introspectionHeaders,
        });

        const text = result.content[0].text;
        expect(text).toContain('"name": "Hat"');
        expect(text).toContain("Auto-corrections applied:");
        expect(text).toContain('"nme" on Product');
        expect(text).toContain("Corrected query:");
    });

    it("returns both errors when retry also fails", async () => {
        const { queryExecutor, executor, graphqlQueryCorrector } = setup();
        executor.mockRejectedValueOnce(new Error("Original error"));
        executor.mockRejectedValueOnce(new Error("Retry error"));

        const correction: CorrectionResult = {
            correctedQuery: "{ products { name } }",
            corrections: [{ field: "nme", parentType: "Product", suggestion: "name", kind: "unknown-field" }],
            errors: [],
        };
        graphqlQueryCorrector.mockResolvedValue(correction);

        const result = await queryExecutor({
            executor,
            query: "{ products { nme } }",
            introspectionUrl,
            introspectionHeaders,
        });

        const text = result.content[0].text;
        expect(text).toContain("Original error");
        expect(text).toContain("Retry also failed");
        expect(text).toContain("Retry error");
    });

    it("returns non-correctable errors", async () => {
        const { queryExecutor, executor, graphqlQueryCorrector } = setup();
        executor.mockRejectedValueOnce(new Error("GraphQL error"));

        const correction: CorrectionResult = {
            correctedQuery: "{ products { name } }",
            corrections: [],
            errors: ["Fragment cycle detected"],
        };
        graphqlQueryCorrector.mockResolvedValue(correction);

        const result = await queryExecutor({
            executor,
            query: "{ products { name } }",
            introspectionUrl,
            introspectionHeaders,
        });

        const text = result.content[0].text;
        expect(text).toContain("GraphQL error");
        expect(text).toContain("Non-correctable issues");
        expect(text).toContain("Fragment cycle detected");
    });

    it("falls through to generic error when correction itself throws", async () => {
        const { queryExecutor, executor, graphqlQueryCorrector } = setup();
        executor.mockRejectedValueOnce(new Error("Query failed"));
        graphqlQueryCorrector.mockRejectedValue(new Error("Introspection unavailable"));

        const result = await queryExecutor({
            executor,
            query: "{ bad }",
            introspectionUrl,
            introspectionHeaders,
        });

        const text = result.content[0].text;
        expect(text).toBe("GraphQL errors:\nQuery failed");
    });
});
