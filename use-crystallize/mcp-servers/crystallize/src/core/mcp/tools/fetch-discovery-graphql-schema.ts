import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { GraphqlSchemaCompacter } from "../../../contracts/graphql-schema-compacter";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { tenantSchema, sanitizeErrorMessage, buildApiUrl } from "../../security";

type Deps = {
    graphqlSchemaCompacter: GraphqlSchemaCompacter;
    tenantMatcher: TenantMatcher;
};

export const createFetchDiscoveryGraphqlSchemaToolWrapper = ({ graphqlSchemaCompacter, tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Discovery API for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "Use this as a second step when you need to understand specific types or fields not covered by the skills. " +
            "The Discovery API is a storefront API for searching, browsing, filtering, and faceting items and products " +
            "to build frontends — it uses a shape-typed schema where each shape in the tenant becomes a GraphQL type.",
        inputSchema: z.object({
            tenant: tenantSchema,
        }),
        annotions: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = buildApiUrl("https://api.crystallize.com", matchedTenant.identifier, "/discovery");
            const headers: Record<string, string> = matchedTenant.staticAuthToken
                ? { "X-Crystallize-Static-Auth-Token": matchedTenant.staticAuthToken }
                : {};
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
                            text: `Failed to fetch discovery schema: ${sanitizeErrorMessage(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
