import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { CoreSchemaDomainSplitter, DomainIndex } from "../../../contracts/core-schema-domain-splitter";
import { fetchIntrospection } from "../../services/compact-schema-builder";
import { tenantSchema, sanitizeErrorMessage, buildAtApiUrl } from "../../security";

type Deps = {
    coreSchemaDomainSplitter: CoreSchemaDomainSplitter;
    tenantMatcher: TenantMatcher;
    authContextResolver: AuthContextResolver;
};

function formatDomainIndex(index: DomainIndex): string {
    const lines = [
        "# Core API Schema Domains",
        "",
        "Call this tool again with `domain` set to one of the following to get the detailed schema.",
        "",
    ];
    for (const d of index.domains) {
        const qCount = d.queries.length;
        const mCount = d.mutations.length;
        const parts: string[] = [];
        if (qCount > 0) parts.push(`${qCount} queries`);
        if (mCount > 0) parts.push(`${mCount} mutations`);
        lines.push(`## ${d.name} (${parts.join(", ")})`);
        if (qCount > 0) lines.push(`Queries: ${d.queries.join(", ")}`);
        if (mCount > 0) lines.push(`Mutations: ${d.mutations.join(", ")}`);
        lines.push("");
    }
    return lines.join("\n");
}

export const createFetchCoreGraphqlSchemaToolWrapper = ({
    coreSchemaDomainSplitter,
    tenantMatcher,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Core API (aka Core Next) for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "The Core API schema is large, so it is split into domains. You MUST provide a `domain` parameter. " +
            "Common domains: order, customer, subscription, subscriptionPlan, pricelist, pipeline, flow, app, user, webhook, stockLocation, invite. " +
            "If the domain you need is not listed, call without `domain` to get the full list. " +
            "The Core API is the admin API — use it for orders, customers, price lists, users, subscriptions, " +
            "subscription plans, pipelines, flows, apps, and other back-office/admin resources. " +
            "Do NOT use this for fetching items or products for storefronts — use Catalogue or Discovery APIs instead.",
        inputSchema: z.object({
            tenant: tenantSchema,
            domain: z
                .string()
                .optional()
                .describe(
                    "The domain to fetch the schema for (e.g. 'order', 'customer', 'subscription'). " +
                        "Omit to get the full list of available domains.",
                ),
        }),
        annotions: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, domain, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = buildAtApiUrl("https://api.crystallize.com", matchedTenant.identifier, "");
            const headers: Record<string, string> = authContextResolver.getAuthHeaders(authContext);
            try {
                const introspection = await fetchIntrospection(url, headers);

                if (!domain) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: formatDomainIndex(coreSchemaDomainSplitter.listDomains(introspection)),
                            },
                        ],
                    };
                }

                // Check if domain exists, if not return available domains
                const index = coreSchemaDomainSplitter.listDomains(introspection);
                const domainExists = index.domains.some((d) => d.name === domain);
                if (!domainExists) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Unknown domain "${domain}". Here are the available domains:\n\n${formatDomainIndex(index)}`,
                            },
                        ],
                    };
                }

                const schema = coreSchemaDomainSplitter.getCompactedDomainSchema(introspection, domain, "both");
                return {
                    content: [{ type: "text", text: schema }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Failed to fetch core schema: ${sanitizeErrorMessage(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
