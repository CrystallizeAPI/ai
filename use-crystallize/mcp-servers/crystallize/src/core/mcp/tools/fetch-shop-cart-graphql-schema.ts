import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { GraphqlSchemaCompacter } from "../../../contracts/graphql-schema-compacter";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { AuthContext } from "../../../contracts/app-context";

type Deps = {
    graphqlSchemaCompacter: GraphqlSchemaCompacter;
    tenantMatcher: TenantMatcher;
    authContextResolver: AuthContextResolver;
};

const fetchShopApiToken = async (
    tenant: string,
    authContext: AuthContext,
    authContextResolver: AuthContextResolver,
): Promise<string> => {
    const response = await fetch(`https://shop-api.crystallize.com/@${tenant}/auth/token`, {
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
        throw new Error("Could not fetch shop API token: " + (results.error || "unknown error"));
    }
    return results.token;
};

export const createFetchShopCartGraphqlSchemaToolWrapper = ({
    graphqlSchemaCompacter,
    tenantMatcher,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Shop Cart API for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "Use this as a second step when you need to understand specific types or fields not covered by the skills. " +
            "The Shop Cart API handles cart operations — creating carts, adding/removing items, " +
            "applying discounts, and reading cart state. " +
            "Do NOT use this for orders or subscription contracts — those are separate Shop API endpoints.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
        }),
        handler: async ({ tenant, authContext }) => {
            tenantMatcher(authContext.tenants, { identifier: tenant });
            const shopApiToken = await fetchShopApiToken(tenant, authContext, authContextResolver);
            const url = `https://shop-api.crystallize.com/@${tenant}/cart`;
            const headers: Record<string, string> = {
                Authorization: `Bearer ${shopApiToken}`,
            };
            try {
                const schema = await graphqlSchemaCompacter(url, { operations: "both", headers });
                return {
                    content: [{ type: "text", text: schema }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to fetch shop cart schema: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
