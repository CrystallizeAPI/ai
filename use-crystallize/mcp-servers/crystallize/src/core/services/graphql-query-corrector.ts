import { buildClientSchema, parse, validate } from "graphql";
import type { GraphQLField, GraphQLNamedType } from "graphql";
import { closest } from "fastest-levenshtein";
import { type CorrectionLog, type GraphqlQueryCorrector } from "../../contracts/graphql-query-corrector";
import { fetchIntrospection } from "./compact-schema-builder";

function getTypeFields(type: GraphQLNamedType): Record<string, GraphQLField<unknown, unknown>> | null {
    if ("getFields" in type && typeof type.getFields === "function") {
        return type.getFields() as Record<string, GraphQLField<unknown, unknown>>;
    }
    return null;
}

export const createGraphqlQueryCorrector = (): GraphqlQueryCorrector => {
    return async (query: string, introspectionUrl: string, headers: Record<string, string>) => {
        const introspection = await fetchIntrospection(introspectionUrl, headers);
        const schema = buildClientSchema(introspection.data as never);

        let document;
        try {
            document = parse(query);
        } catch {
            return null;
        }

        const errors = validate(schema, document);
        if (errors.length === 0) return null;

        const corrections: CorrectionLog[] = [];
        const nonCorrectableErrors: string[] = [];
        const replacements: { start: number; end: number; replacement: string }[] = [];

        for (const error of errors) {
            const fieldMatch = error.message.match(/Cannot query field "(\w+)" on type "(\w+)"/);
            if (fieldMatch) {
                const [, fieldName, typeName] = fieldMatch;
                const type = schema.getType(typeName);
                if (type) {
                    const fields = getTypeFields(type);
                    if (fields) {
                        const candidates = Object.keys(fields);
                        // Use GraphQL's own suggestion first
                        const suggestMatch = error.message.match(/Did you mean "(\w+)"/);
                        const suggestion =
                            suggestMatch?.[1] ??
                            (candidates.length > 0 ? closest(fieldName.toLowerCase(), candidates) : null);
                        if (suggestion) {
                            corrections.push({
                                field: fieldName,
                                parentType: typeName,
                                suggestion,
                                kind: "unknown-field",
                            });
                            // Use error.nodes to find the exact AST node for replacement
                            const node = error.nodes?.[0];
                            if (node?.kind === "Field" && node.name?.loc) {
                                replacements.push({
                                    start: node.name.loc.start,
                                    end: node.name.loc.end,
                                    replacement: suggestion,
                                });
                            }
                            continue;
                        }
                    }
                }
                nonCorrectableErrors.push(error.message);
                continue;
            }

            const argMatch = error.message.match(/Unknown argument "(\w+)" on field "(\w+)\.(\w+)"/);
            if (argMatch) {
                const [, argName, typeName, fieldNameOnType] = argMatch;
                const type = schema.getType(typeName);
                if (type) {
                    const fields = getTypeFields(type);
                    const field = fields?.[fieldNameOnType];
                    if (field) {
                        const argNames = field.args.map((a) => a.name);
                        const suggestMatch = error.message.match(/Did you mean "(\w+)"/);
                        const suggestion =
                            suggestMatch?.[1] ??
                            (argNames.length > 0 ? closest(argName.toLowerCase(), argNames) : null);
                        if (suggestion) {
                            corrections.push({
                                field: argName,
                                parentType: `${typeName}.${fieldNameOnType}`,
                                suggestion,
                                kind: "unknown-argument",
                            });
                            const node = error.nodes?.[0];
                            if (node?.kind === "Argument" && node.name?.loc) {
                                replacements.push({
                                    start: node.name.loc.start,
                                    end: node.name.loc.end,
                                    replacement: suggestion,
                                });
                            }
                            continue;
                        }
                    }
                }
                nonCorrectableErrors.push(error.message);
                continue;
            }

            nonCorrectableErrors.push(error.message);
        }

        if (corrections.length === 0 && nonCorrectableErrors.length > 0) {
            return { correctedQuery: query, corrections: [], errors: nonCorrectableErrors };
        }

        if (corrections.length === 0) return null;

        // Apply replacements in reverse order to preserve offsets
        replacements.sort((a, b) => b.start - a.start);
        let correctedQuery = query;
        for (const r of replacements) {
            correctedQuery = correctedQuery.slice(0, r.start) + r.replacement + correctedQuery.slice(r.end);
        }

        return { correctedQuery, corrections, errors: nonCorrectableErrors };
    };
};
