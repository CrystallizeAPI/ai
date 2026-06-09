import type { QueryExecutorResult } from "./query-executor";

export type MutationExecutorOptions = {
    executor: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
    query: string;
    variables?: Record<string, unknown>;
};

// Sibling of QueryExecutor, but executes EXACTLY ONCE — no Levenshtein
// correction, no retry. A failed mutation must never be silently re-sent.
export type MutationExecutor = (options: MutationExecutorOptions) => Promise<QueryExecutorResult>;
