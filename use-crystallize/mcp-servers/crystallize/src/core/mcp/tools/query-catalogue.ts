import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { QueryExecutor } from "../../../contracts/query-executor";

type Deps = {
    tenantMatcher: TenantMatcher;
    queryExecutor: QueryExecutor;
};

export const createQueryCatalogueToolWrapper = ({ tenantMatcher, queryExecutor }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a GraphQL query against the Crystallize Catalogue API. " +
            "If you haven't already, call the `skills` tool first — it provides query examples and best practices " +
            "that will help you write correct queries. " +
            "The Catalogue API is a storefront API for fetching items, products, and content to build frontends. " +
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

            const introspectionHeaders: Record<string, string> = {};
            if (matchedTenant.staticAuthToken) {
                introspectionHeaders["X-Crystallize-Static-Auth-Token"] = matchedTenant.staticAuthToken;
            } else {
                introspectionHeaders["X-Crystallize-Access-Token-Id"] = authContext.accessTokenId;
                introspectionHeaders["X-Crystallize-Access-Token-Secret"] = authContext.accessTokenSecret;
            }

            return queryExecutor({
                executor: (q, v) => client.catalogueApi(q, v),
                introspectionUrl: `https://api.crystallize.com/${tenant}/catalogue`,
                introspectionHeaders,
                query,
                variables,
            });
        },
    });
};
