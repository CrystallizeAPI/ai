import type { IntrospectionResult } from "../core/services/compact-schema-builder";

export type DomainInfo = {
    name: string;
    queries: string[];
    mutations: string[];
};

export type DomainIndex = {
    domains: DomainInfo[];
};

export type CoreSchemaDomainSplitter = {
    listDomains(introspection: IntrospectionResult): DomainIndex;
    getCompactedDomainSchema(
        introspection: IntrospectionResult,
        domain: string,
        operations: "queries" | "mutations" | "both",
    ): string;
};
