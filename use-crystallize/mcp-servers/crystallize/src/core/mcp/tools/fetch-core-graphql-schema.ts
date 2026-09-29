import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";
import { CoreSchemaDomainSplitter, DomainIndex } from "../../../contracts/core-schema-domain-splitter";
import type { CoreDomainSelector, SelectedDomain } from "../../../contracts/core-domain-selector";
import { fetchIntrospection } from "../../services/compact-schema-builder";
import { tenantSchema, sanitizeErrorMessage, buildAtApiUrl } from "../../security";

type Deps = {
    coreSchemaDomainSplitter: CoreSchemaDomainSplitter;
    coreDomainSelector: CoreDomainSelector;
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

function formatSelectionHeader(selected: SelectedDomain[]): string {
    const picked = selected.map((d) => `${d.name} (${Math.round(d.probability * 100)}%)`).join(", ");
    return (
        `# Core API schema for: ${selected.map((d) => d.name).join(", ")}\n\n` +
        `Domains picked for your intent: ${picked}. If something is missing, call again with \`domain\` ` +
        "set to the one you need, or with neither `intent` nor `domain` for the full list.\n\n"
    );
}

const NO_SELECTION_NOTE =
    "Could not pick domains for this intent automatically. Call again with `domain` set to one of the following.\n\n";

export const createFetchCoreGraphqlSchemaToolWrapper = ({
    coreSchemaDomainSplitter,
    coreDomainSelector,
    tenantMatcher,
    authContextResolver,
}: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the compacted GraphQL schema of the Crystallize Core API (aka Core Next) for a given tenant. " +
            "BEFORE calling this tool, call the `skills` tool first to get documentation and query examples — " +
            "skills often provide enough context to build queries without needing the full schema. " +
            "The Core API schema is large, so it is split into domains. Prefer passing `intent`: a one-sentence " +
            "description of what you want to do (e.g. 'create an order for an existing customer'); the server " +
            "then returns the schema of every domain that task needs, in one call. " +
            "Pass `domain` instead when you already know the exact domain. " +
            "Common domains: order, customer, subscription, subscriptionPlan, pricelist, pipeline, flow, app, user, webhook, stockLocation, invite. " +
            "Call with neither to get the full list of domains. " +
            "The Core API is the admin API — use it for orders, customers, price lists, users, subscriptions, " +
            "subscription plans, pipelines, flows, apps, and other back-office/admin resources. " +
            "Do NOT use this for fetching items or products for storefronts — use Catalogue or Discovery APIs instead.",
        inputSchema: z.object({
            tenant: tenantSchema,
            domain: z
                .string()
                .optional()
                .describe(
                    "The exact domain to fetch the schema for (e.g. 'order', 'customer', 'subscription'). " +
                        "Takes precedence over `intent`.",
                ),
            intent: z
                .string()
                .max(1000)
                .optional()
                .describe(
                    "What you want to do with the Core API, in one sentence " +
                        "(e.g. 'list the orders of a customer and their subscriptions'). " +
                        "The server picks the relevant domains and returns their combined schema.",
                ),
        }),
        annotations: {
            readOnlyHint: true,
        },
        handler: async ({ tenant, domain, intent, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const url = buildAtApiUrl("https://api.crystallize.com", matchedTenant.identifier, "");
            const headers: Record<string, string> = authContextResolver.getAuthHeaders(authContext);
            const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
            try {
                const introspection = await fetchIntrospection(url, headers);
                const index = coreSchemaDomainSplitter.listDomains(introspection);

                if (domain) {
                    if (!index.domains.some((d) => d.name === domain)) {
                        return text(
                            `Unknown domain "${domain}". Here are the available domains:\n\n${formatDomainIndex(index)}`,
                        );
                    }
                    return text(coreSchemaDomainSplitter.getCompactedDomainSchema(introspection, domain, "both"));
                }

                if (intent?.trim()) {
                    let selected: SelectedDomain[] = [];
                    try {
                        selected = await coreDomainSelector.select(index, intent);
                    } catch (error) {
                        // Selection is an optimization: when Jev is unavailable, the index still works.
                        console.warn(`Core domain selection failed: ${sanitizeErrorMessage(error)}`);
                    }
                    if (selected.length === 0) {
                        return text(NO_SELECTION_NOTE + formatDomainIndex(index));
                    }
                    const schema = coreSchemaDomainSplitter.getCompactedDomainsSchema(
                        introspection,
                        selected.map((d) => d.name),
                        "both",
                    );
                    return text(formatSelectionHeader(selected) + schema);
                }

                return text(formatDomainIndex(index));
            } catch (error) {
                return text(`Failed to fetch core schema: ${sanitizeErrorMessage(error)}`);
            }
        },
    });
};
