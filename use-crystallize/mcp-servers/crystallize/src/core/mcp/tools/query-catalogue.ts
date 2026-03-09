import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";

type Deps = {
    tenantMatcher: TenantMatcher;
};

export const createQueryCatalogueToolWrapper = ({ tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a GraphQL query against the Crystallize Catalogue API. " +
            "The Catalogue API provides path-based reads with strong consistency and union types for components. " +
            "Use this for reading specific items by path or ID, traversing the catalogue tree, " +
            "and accessing detailed component data with full type support.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
            query: z.string().describe("The GraphQL query to execute"),
            variables: z.record(z.string(), z.unknown()).optional().describe("Optional GraphQL variables"),
        }),
        handler: async ({ tenant, query, variables, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: tenant,
                accessTokenId: authContext.accessTokenId,
                accessTokenSecret: authContext.accessTokenSecret,
                staticAuthToken: matchedTenant.staticAuthToken,
            });
            try {
                const data = await client.catalogueApi(query, variables);
                return {
                    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `GraphQL errors:\n${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
