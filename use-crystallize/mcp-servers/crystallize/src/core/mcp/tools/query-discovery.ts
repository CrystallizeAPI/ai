import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";

type Deps = {
    tenantMatcher: TenantMatcher;
};
export const createQueryDiscoveryToolWrapper = ({ tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a GraphQL query against the Crystallize Discovery API. " +
            "The Discovery API provides search, browse, filter, and faceting capabilities over the catalogue. " +
            "It uses a shape-typed schema where each shape in the tenant becomes a GraphQL type. " +
            "Use this for searching, filtering, listing items, and aggregating data.",
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
                const data = await client.discoveryApi(query, variables);
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
