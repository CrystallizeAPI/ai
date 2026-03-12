import { parse } from "graphql";
import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { QueryExecutor } from "../../../contracts/query-executor";

type Deps = {
    tenantMatcher: TenantMatcher;
    queryExecutor: QueryExecutor;
};

const fetchShopApiToken = async (
    tenant: string,
    authContext: { accessTokenId: string; accessTokenSecret: string },
): Promise<string> => {
    const response = await fetch(`https://shop-api.crystallize.com/@${tenant}/auth/token`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            Accept: "application/json",
            "X-Crystallize-Access-Token-Id": authContext.accessTokenId,
            "X-Crystallize-Access-Token-Secret": authContext.accessTokenSecret,
        },
        body: JSON.stringify({ scopes: ["cart"], expiresIn: 3600 * 12 }),
    });
    const results = (await response.json()) as { success: boolean; token?: string; error?: string };
    if (!results.success || !results.token) {
        throw new Error("Could not fetch shop API token: " + (results.error || "unknown error"));
    }
    return results.token;
};

export const createQueryShopCartToolWrapper = ({ tenantMatcher, queryExecutor }: Deps) => {
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
            tenant: z.string().describe("The tenant identifier"),
            query: z.string().describe("The GraphQL query to execute (mutations are not allowed)"),
            variables: z.record(z.string(), z.unknown()).optional().describe("Optional GraphQL variables"),
        }),
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
                tenantIdentifier: tenant,
                accessTokenId: authContext.accessTokenId,
                accessTokenSecret: authContext.accessTokenSecret,
                staticAuthToken: matchedTenant.staticAuthToken,
            });

            const shopApiToken = await fetchShopApiToken(tenant, authContext);
            const introspectionUrl = `https://shop-api.crystallize.com/@${tenant}/cart`;
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
