import z from "zod";
import html from "virtual:app/product-overview";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { tenantSchema } from "../../security";

type Deps = {
    tenantMatcher: TenantMatcher;
};

const hitSchema = z
    .object({
        id: z.string().optional(),
        name: z.string().optional(),
        path: z.string().optional(),
        type: z.string().optional(),
        defaultVariant: z.unknown().optional(),
        variants: z.array(z.unknown()).optional(),
    })
    .loose();

const summarySchema = z
    .object({
        totalHits: z.number().optional(),
        endCursor: z.string().optional(),
        hasMoreHits: z.boolean().optional(),
    })
    .loose();

export const createProductOverviewToolWrapper = ({ tenantMatcher }: Deps) => {
    return defineToolWrapper({
        description:
            "Display Crystallize catalogue items (products, documents, folders) as an interactive UI panel of cards. " +
            "Use this AFTER calling `query-discovery` when the user wants to *see* items rather than inspect raw data — " +
            "for example when the user asks 'show me red shoes' or 'find products under $50'. " +
            "Pass the `hits` array (and optional `summary`) returned by the Discovery query along with the `tenant` and `language`. " +
            "Tip: project at least `name`, `path`, `type`, and `defaultVariant { firstImage { url }, defaultPrice, sku, priceVariants { currency, identifier, price } }` " +
            "for the best card rendering. Include `variants { sku, name, isDefault, defaultPrice, firstImage { url } }` if you want a variant switcher in the detail view. " +
            "Components and other rich content fields are not rendered.",
        inputSchema: z.object({
            tenant: tenantSchema,
            language: z.string().min(2).describe("Language code used by the Discovery query (e.g. 'en')"),
            hits: z.array(hitSchema).describe("The `hits` array returned by a Discovery `search` or `browse` query"),
            summary: summarySchema.optional().describe("The optional `summary` object from the Discovery query"),
        }),
        annotions: {
            readOnlyHint: true,
        },
        ui: {
            resourceUri: "ui://crystallize/product-overview.html",
            name: "Crystallize Product Overview",
            description: "Interactive panel rendering Crystallize catalogue items as cards.",
            html,
            meta: {
                csp: {
                    resourceDomains: ["https://media.crystallize.com", "https://*.crystallize.com"],
                },
            },
        },
        handler: async ({ tenant, language, hits, summary, authContext }) => {
            const matched = tenantMatcher(authContext.tenants, { identifier: tenant });
            const payload = {
                tenant: {
                    id: matched.id,
                    identifier: matched.identifier,
                    name: matched.name,
                },
                language,
                hits,
                summary,
                fetchedAt: new Date().toISOString(),
            };
            return {
                content: [{ type: "text", text: JSON.stringify(payload) }],
            };
        },
    });
};
