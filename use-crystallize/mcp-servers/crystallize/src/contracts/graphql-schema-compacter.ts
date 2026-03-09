export type GraphqlSchemaCompacterOptions = {
    operations?: "queries" | "mutations" | "both";
    headers?: Record<string, string>;
};

export type GraphqlSchemaCompacter = (url: string, options?: GraphqlSchemaCompacterOptions) => Promise<string>;
