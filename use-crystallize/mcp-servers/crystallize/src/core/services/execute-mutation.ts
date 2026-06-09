import { JSApiClientCallError } from "@crystallize/js-api-client";
import type { MutationExecutor } from "../../contracts/mutation-executor";
import { sanitizeErrorMessage } from "../security";

// Execute-once executor for mutations. Unlike queryExecutor it never runs the
// query corrector and never retries — a destructive op that failed stays
// failed, and the error (including upstream GraphQL errors) is surfaced as-is.
export const createMutationExecutor =
    (): MutationExecutor =>
    async ({ executor, query, variables }) => {
        try {
            const data = await executor(query, variables);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
            let text = `GraphQL errors:\n${sanitizeErrorMessage(error)}`;
            if (error instanceof JSApiClientCallError && error.errors) {
                text += `\n\nDetails:\n${JSON.stringify(error.errors, null, 2)}`;
            }
            return { content: [{ type: "text", text }] };
        }
    };
