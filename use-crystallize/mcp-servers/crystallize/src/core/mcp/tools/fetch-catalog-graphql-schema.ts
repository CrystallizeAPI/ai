import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { GraphqlSchemaCompacter } from "../../../contracts/graphql-schema-compacter";
import { TenantMatcher } from "../../../contracts/tenant-matcher";

type Deps = {
    graphqlSchemaCompacter: GraphqlSchemaCompacter;
    tenantMatcher: TenantMatcher;
};

export const createFetchCatalogGraphqlSchemaToolWrapper = ({ graphqlSchemaCompacter, tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Catalogue API for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "Use this as a second step when you need to understand specific types or fields not covered by the skills. " +
            "The Catalogue API is a storefront API for fetching items, products, and content " +
            "to build frontends — it provides path-based reads with strong consistency and union types for components.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
        }),
        handler: async ({ tenant, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            if (authContext.type !== "token" && !matchedTenant.staticAuthToken) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "The Catalogue API requires token-based authentication or a static auth token.",
                        },
                    ],
                };
            }
            const url = `https://api.crystallize.com/${tenant}/catalogue`;
            const headers: Record<string, string> = {};
            if (matchedTenant.staticAuthToken) {
                headers["X-Crystallize-Static-Auth-Token"] = matchedTenant.staticAuthToken;
            } else if (authContext.type === "token") {
                headers["X-Crystallize-Access-Token-Id"] = authContext.accessTokenId;
                headers["X-Crystallize-Access-Token-Secret"] = authContext.accessTokenSecret;
            }
            try {
                const schema = await graphqlSchemaCompacter(url, { operations: "queries", headers });
                return {
                    content: [{ type: "text" as const, text: schema }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `Failed to fetch catalogue schema: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
