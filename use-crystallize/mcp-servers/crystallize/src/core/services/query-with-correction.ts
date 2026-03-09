import type { GraphqlQueryCorrector } from "../../contracts/graphql-query-corrector";
import type { QueryExecutor } from "../../contracts/query-executor";

type Deps = {
    graphqlQueryCorrector: GraphqlQueryCorrector;
};

export const createQueryExecutor =
    ({ graphqlQueryCorrector }: Deps): QueryExecutor =>
    async ({ executor, query, variables, introspectionUrl, introspectionHeaders }) => {
        try {
            const data = await executor(query, variables);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            try {
                const result = await graphqlQueryCorrector(query, introspectionUrl, introspectionHeaders);

                if (result && result.corrections.length > 0) {
                    // Retry with corrected query
                    try {
                        const data = await executor(result.correctedQuery, variables);
                        const correctionsLog = result.corrections
                            .map((c) => `- "${c.field}" on ${c.parentType} → "${c.suggestion}" (${c.kind})`)
                            .join("\n");
                        let text = JSON.stringify(data, null, 2);
                        text += `\n\n---\nAuto-corrections applied:\n${correctionsLog}`;
                        text += `\n\nCorrected query:\n${result.correctedQuery}`;
                        if (result.errors.length > 0) {
                            text += `\n\nAdditional issues (not auto-corrected):\n${result.errors.map((e) => `- ${e}`).join("\n")}`;
                        }
                        return { content: [{ type: "text", text }] };
                    } catch (retryError) {
                        const retryMessage = retryError instanceof Error ? retryError.message : String(retryError);
                        const correctionsLog = result.corrections
                            .map((c) => `- "${c.field}" → "${c.suggestion}"`)
                            .join("\n");
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `GraphQL errors:\n${errorMessage}\n\nAttempted corrections:\n${correctionsLog}\n\nRetry also failed:\n${retryMessage}`,
                                },
                            ],
                        };
                    }
                }

                if (result && result.errors.length > 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `GraphQL errors:\n${errorMessage}\n\nNon-correctable issues:\n${result.errors.map((e) => `- ${e}`).join("\n")}`,
                            },
                        ],
                    };
                }
            } catch {
                // Correction itself failed (e.g., introspection unavailable), fall through
            }

            return { content: [{ type: "text", text: `GraphQL errors:\n${errorMessage}` }] };
        }
    };
