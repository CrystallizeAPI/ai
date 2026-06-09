import { parse } from "graphql";
import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { MutationExecutor } from "../../../contracts/mutation-executor";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { tenantSchema, querySchema, variablesSchema } from "../../security";

type Deps = {
    tenantMatcher: TenantMatcher;
    mutationExecutor: MutationExecutor;
    authContextResolver: AuthContextResolver;
};

export const createMutateCoreToolWrapper = ({ tenantMatcher, mutationExecutor, authContextResolver }: Deps) => {
    return defineToolWrapper({
        write: true,
        description:
            "Execute a GraphQL MUTATION against the Crystallize Core API (aka Core Next). " +
            "This WRITES to the tenant — create/update/publish items, components, folders, and other PIM resources. " +
            "If you haven't already, call the `skills` tool first — it provides mutation examples and best practices. " +
            "Only mutations are allowed here — for reads use the `query-core` tool instead. " +
            "The mutation is executed exactly once; it is never auto-corrected or retried, so verify your query first. " +
            "For large batches of changes, prefer `run-mass-operation`.",
        inputSchema: z.object({
            tenant: tenantSchema,
            query: querySchema,
            variables: variablesSchema,
        }),
        annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
        },
        handler: async ({ tenant, query, variables, authContext }) => {
            try {
                const doc = parse(query);
                const ops = doc.definitions.filter((d) => d.kind === "OperationDefinition");
                const hasMutation = ops.some((d) => d.kind === "OperationDefinition" && d.operation === "mutation");
                const hasNonMutation = ops.some((d) => d.kind === "OperationDefinition" && d.operation !== "mutation");
                if (!hasMutation) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "No mutation found. This tool only executes mutations — use the `query-core` tool for read-only queries.",
                            },
                        ],
                    };
                }
                if (hasNonMutation) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Mixed query/mutation documents are not allowed here. Submit a mutation-only document; run reads through `query-core`.",
                            },
                        ],
                    };
                }
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to parse GraphQL query: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }

            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: matchedTenant.identifier,
                tenantId: matchedTenant.id,
                ...authContextResolver.getClientCredentials(authContext),
            });

            return mutationExecutor({
                executor: (q, v) => client.nextPimApi(q, v),
                query,
                variables,
            });
        },
    });
};
