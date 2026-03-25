import { parse } from "graphql";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { QueryExecutor } from "../../../contracts/query-executor";
import { createClient } from "@crystallize/js-api-client";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { tenantSchema, readOnlyQuerySchema, variablesSchema, buildAtApiUrl } from "../../security";

type Deps = {
    tenantMatcher: TenantMatcher;
    queryExecutor: QueryExecutor;
    authContextResolver: AuthContextResolver;
};

export const createQueryCoreToolWrapper = ({ tenantMatcher, queryExecutor, authContextResolver }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a read-only GraphQL query against the Crystallize Core API (aka Core Next). " +
            "If you haven't already, call the `skills` tool first — it provides query examples and best practices " +
            "that will help you write correct queries. " +
            "The Core API is the admin API — use it for orders, customers, price lists, users, subscriptions, " +
            "subscription plans, pipelines, flows, apps, and other back-office/admin resources. " +
            "Only queries are allowed — mutations are blocked. " +
            "Do NOT use this for fetching items or products for storefronts — use Catalogue or Discovery APIs instead.",
        inputSchema: z.object({
            tenant: tenantSchema,
            query: readOnlyQuerySchema,
            variables: variablesSchema,
        }),
        annotions: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, query, variables, authContext }) => {
            try {
                const doc = parse(query);
                const hasMutation = doc.definitions.some(
                    (d) => d.kind === "OperationDefinition" && d.operation === "mutation",
                );
                if (hasMutation) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: "Mutations are not allowed on the Core API through this tool. Only queries are supported.",
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

            return queryExecutor({
                executor: (q, v) => client.nextPimApi(q, v),
                introspectionUrl: buildAtApiUrl("https://api.crystallize.com", matchedTenant.identifier, ""),
                introspectionHeaders: authContextResolver.getAuthHeaders(authContext),
                query,
                variables,
            });
        },
    });
};
