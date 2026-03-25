export type GraphqlSchemaCompacterOptions = {
    operations?: "queries" | "mutations" | "both";
    headers?: Record<string, string>;
};

export type CompactSchemaOptions = {
    operations?: "queries" | "mutations" | "both";
    rootFieldFilter?: Set<string>;
};

export type GraphqlSchemaCompacter = (url: string, options?: GraphqlSchemaCompacterOptions) => Promise<string>;
