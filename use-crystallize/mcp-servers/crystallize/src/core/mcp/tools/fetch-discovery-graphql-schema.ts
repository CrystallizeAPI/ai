import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { GraphqlSchemaCompacter } from "../../../contracts/graphql-schema-compacter";
import { TenantMatcher } from "../../../contracts/tenant-matcher";

type Deps = {
    graphqlSchemaCompacter: GraphqlSchemaCompacter;
    tenantMatcher: TenantMatcher;
};

export const createFetchDiscoveryGraphqlSchemaToolWrapper = ({ graphqlSchemaCompacter, tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Discovery API for a given tenant. " +
            "Use this to understand the available queries, types, and fields before building a discovery query. " +
            "The Discovery API provides search, browse, filter, and faceting capabilities " +
            "with a shape-typed schema where each shape in the tenant becomes a GraphQL type.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
        }),
        handler: async ({ tenant, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = `https://api.crystallize.com/${tenant}/discovery`;
            const headers: Record<string, string> = {};
            if (matchedTenant.staticAuthToken) {
                headers["X-Crystallize-Static-Auth-Token"] = matchedTenant.staticAuthToken;
            } else {
                headers["X-Crystallize-Access-Token-Id"] = authContext.accessTokenId;
                headers["X-Crystallize-Access-Token-Secret"] = authContext.accessTokenSecret;
            }
            try {
                const schema = await graphqlSchemaCompacter(url, { operations: "queries", headers });
                return {
                    content: [{ type: "text", text: schema }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to fetch discovery schema: ${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
