export type QueryExecutorOptions = {
    executor: (query: string, variables?: Record<string, unknown>) => Promise<unknown>;
    introspectionUrl: string;
    introspectionHeaders: Record<string, string>;
    query: string;
    variables?: Record<string, unknown>;
};

export type QueryExecutorResult = {
    content: Array<{ text: string; type: "text" }>;
};

export type QueryExecutor = (options: QueryExecutorOptions) => Promise<QueryExecutorResult>;
