import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { QueryExecutor } from "../../../contracts/query-executor";
type Deps = {
    tenantMatcher: TenantMatcher;
    queryExecutor: QueryExecutor;
};
export const createQueryDiscoveryToolWrapper = ({ tenantMatcher, queryExecutor }: Deps) => {
    return defineToolWrapper({
        description:
            "Execute a GraphQL query against the Crystallize Discovery API. " +
            "If you haven't already, call the `skills` tool first — it provides query examples and best practices " +
            "that will help you write correct queries. " +
            "The Discovery API is a storefront API for searching, browsing, filtering, and faceting items and products " +
            "to build frontends. It uses a shape-typed schema where each shape in the tenant becomes a GraphQL type. " +
            "Use this for searching, filtering, listing items, and aggregating data for storefront use cases.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
            query: z.string().describe("The GraphQL query to execute"),
            variables: z.record(z.string(), z.unknown()).optional().describe("Optional GraphQL variables"),
        }),
        handler: async ({ tenant, query, variables, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: matchedTenant.identifier,
                tenantId: matchedTenant.id,
                staticAuthToken: matchedTenant.staticAuthToken,
            });

            const introspectionHeaders: Record<string, string> = matchedTenant.staticAuthToken
                ? { "X-Crystallize-Static-Auth-Token": matchedTenant.staticAuthToken }
                : {};

            return queryExecutor({
                executor: (q, v) => client.discoveryApi(q, v),
                introspectionUrl: `https://api.crystallize.com/${tenant}/discovery`,
                introspectionHeaders,
                query,
                variables,
            });
        },
    });
};
