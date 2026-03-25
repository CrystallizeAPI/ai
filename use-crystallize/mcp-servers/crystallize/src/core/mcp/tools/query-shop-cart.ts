import { parse } from "graphql";
import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { QueryExecutor } from "../../../contracts/query-executor";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { AuthContext } from "../../../contracts/app-context";
import { tenantSchema, readOnlyQuerySchema, variablesSchema, buildAtApiUrl } from "../../security";

type Deps = {
    tenantMatcher: TenantMatcher;
    queryExecutor: QueryExecutor;
    authContextResolver: AuthContextResolver;
};

const fetchShopApiToken = async (
    tenant: string,
    authContext: AuthContext,
    authContextResolver: AuthContextResolver,
): Promise<string> => {
    const response = await fetch(buildAtApiUrl("https://shop-api.crystallize.com", tenant, "/auth/token"), {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Accept: "application/json",
            ...authContextResolver.getAuthHeaders(authContext),
        },
        body: JSON.stringify({ scopes: ["cart"], expiresIn: 3600 * 12 }),
    });
    const results = (await response.json()) as { success: boolean; token?: string; error?: string };
    if (!results.success || !results.token) {
        throw new Error("Could not fetch shop API token");
    }
    return results.token;
};

export const createQueryShopCartToolWrapper = ({ tenantMatcher, queryExecutor, authContextResolver }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a read-only GraphQL query against the Crystallize Shop Cart API. " +
            "If you haven't already, call the `skills` tool first — it provides query examples and best practices " +
            "that will help you write correct queries. " +
            "The Shop Cart API handles cart operations — creating carts, adding/removing items, " +
            "applying discounts, and reading cart state. " +
            "Only queries are allowed — mutations are blocked. " +
            "Do NOT use this for orders or subscription contracts — those are separate Shop API endpoints.",
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
                                text: "Mutations are not allowed on the Shop Cart API through this tool. Only queries are supported.",
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
                tenantId: matchedTenant.id,
                tenantIdentifier: matchedTenant.identifier,
                ...authContextResolver.getClientCredentials(authContext),
            });

            const shopApiToken = await fetchShopApiToken(matchedTenant.identifier, authContext, authContextResolver);
            const introspectionUrl = buildAtApiUrl(
                "https://shop-api.crystallize.com",
                matchedTenant.identifier,
                "/cart",
            );
            const introspectionHeaders: Record<string, string> = {
                Authorization: `Bearer ${shopApiToken}`,
            };

            return queryExecutor({
                executor: (q, v) => client.shopCartApi(q, v),
                introspectionUrl,
                introspectionHeaders,
                query,
                variables,
            });
        },
    });
};
