import type { CoreSchemaDomainSplitter, DomainIndex } from "../../contracts/core-schema-domain-splitter";
import { compactSchemaFromIntrospection, type IntrospectionResult } from "./compact-schema-builder";

/**
 * Verb prefixes commonly found on GraphQL root field names.
 * Sorted longest-first so "publish" matches before "pub" (if that existed).
 */
const VERB_PREFIXES = [
    "unpublish",
    "subscribe",
    "unassign",
    "publish",
    "search",
    "remove",
    "create",
    "delete",
    "update",
    "cancel",
    "assign",
    "bulk",
    "list",
    "move",
    "add",
    "set",
    "get",
];

/**
 * Manual overrides for field names that don't follow the verb+noun pattern,
 * or where the auto-detected domain is wrong.
 * Key: root field name, Value: domain name.
 */
const DOMAIN_OVERRIDES: Record<string, string> = {
    // Add overrides here as needed, e.g.:
    // "me": "user",
    // "version": "system",
};

/**
 * Naive singularization: strips trailing "s" for simple plural forms.
 * Handles common patterns like "ies" -> "y", "ses" -> "s".
 */
function singularize(word: string): string {
    if (word.endsWith("ies")) return word.slice(0, -3) + "y";
    if (word.endsWith("ses")) return word.slice(0, -2);
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
}

/**
 * Infer the domain name from a root field name.
 * Strips verb prefixes and normalizes to a singular lowercase stem.
 */
export function inferDomain(fieldName: string): string {
    if (DOMAIN_OVERRIDES[fieldName]) {
        return DOMAIN_OVERRIDES[fieldName];
    }

    let stem = fieldName;

    // Strip verb prefix (case-sensitive match at start, followed by uppercase)
    for (const prefix of VERB_PREFIXES) {
        if (stem.startsWith(prefix) && stem.length > prefix.length) {
            const rest = stem.slice(prefix.length);
            // The character after the prefix should be uppercase (camelCase boundary)
            if (rest[0] === rest[0].toUpperCase() && rest[0] !== rest[0].toLowerCase()) {
                stem = rest;
                break;
            }
        }
    }

    // Normalize: lowercase first char, then singularize
    stem = stem[0].toLowerCase() + stem.slice(1);
    stem = singularize(stem);

    return stem;
}

/**
 * Group root field names by inferred domain.
 */
function groupFieldsByDomain(fieldNames: string[]): Map<string, string[]> {
    const domains = new Map<string, string[]>();
    for (const name of fieldNames) {
        const domain = inferDomain(name);
        if (!domains.has(domain)) domains.set(domain, []);
        domains.get(domain)!.push(name);
    }
    return domains;
}

export const createCoreSchemaDomainSplitter = (): CoreSchemaDomainSplitter => {
    return {
        listDomains(introspection: IntrospectionResult): DomainIndex {
            const schema = introspection.data.__schema;

            const queryType = schema.queryType
                ? schema.types.find((t) => t.name === schema.queryType!.name)
                : undefined;
            const mutationType = schema.mutationType
                ? schema.types.find((t) => t.name === schema.mutationType!.name)
                : undefined;

            const queryFields = queryType?.fields?.map((f) => f.name) ?? [];
            const mutationFields = mutationType?.fields?.map((f) => f.name) ?? [];

            const queryDomains = groupFieldsByDomain(queryFields);
            const mutationDomains = groupFieldsByDomain(mutationFields);

            // Merge all domain names
            const allDomainNames = new Set([...queryDomains.keys(), ...mutationDomains.keys()]);

            const domains = [...allDomainNames].sort().map((name) => ({
                name,
                queries: queryDomains.get(name) ?? [],
                mutations: mutationDomains.get(name) ?? [],
            }));

            return { domains };
        },

        getCompactedDomainSchema(
            introspection: IntrospectionResult,
            domain: string,
            operations: "queries" | "mutations" | "both",
        ): string {
            const index = this.listDomains(introspection);
            const domainInfo = index.domains.find((d) => d.name === domain);
            if (!domainInfo) {
                const available = index.domains.map((d) => d.name).join(", ");
                return `Unknown domain "${domain}". Available domains: ${available}`;
            }

            const fieldNames = new Set<string>();
            if (operations === "queries" || operations === "both") {
                for (const f of domainInfo.queries) fieldNames.add(f);
            }
            if (operations === "mutations" || operations === "both") {
                for (const f of domainInfo.mutations) fieldNames.add(f);
            }

            return compactSchemaFromIntrospection(introspection, {
                operations,
                rootFieldFilter: fieldNames,
            });
        },
    };
};
