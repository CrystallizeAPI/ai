import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { GraphqlSchemaCompacter } from "../../../contracts/graphql-schema-compacter";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";

type Deps = {
    graphqlSchemaCompacter: GraphqlSchemaCompacter;
    tenantMatcher: TenantMatcher;
    authContextResolver: AuthContextResolver;
};

export const createFetchCoreGraphqlSchemaToolWrapper = ({
    graphqlSchemaCompacter,
    tenantMatcher,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Core API (aka Core Next) for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "Use this as a second step when you need to understand specific types or fields not covered by the skills. " +
            "The Core API is the admin API — use it for orders, customers, price lists, users, subscriptions, " +
            "subscription plans, pipelines, flows, apps, and other back-office/admin resources. " +
            "Do NOT use this for fetching items or products for storefronts — use Catalogue or Discovery APIs instead.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
        }),
        handler: async ({ tenant, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = `https://api.crystallize.com/@${matchedTenant.identifier}`;
            const headers: Record<string, string> = authContextResolver.getAuthHeaders(authContext);
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
                            text: `Failed to fetch core schema: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
