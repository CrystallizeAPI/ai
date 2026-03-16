import { createClient } from "@crystallize/js-api-client";
import z from "zod";
import { defineToolWrapper } from "../../../contracts/tool";
import { TenantMatcher } from "../../../contracts/tenant-matcher";
import { AuthContextResolver } from "../../../contracts/auth-context-resolver";

type Deps = {
    tenantMatcher: TenantMatcher;
    authContextResolver: AuthContextResolver;
};

export const createFetchContentModelToolWrapper = ({ tenantMatcher, authContextResolver }: Deps) => {
    return defineToolWrapper({
        description:
            "Fetch the content model (shapes) from a Crystallize tenant. " +
            "If you haven't already, call the `skills` tool first — it explains how content models work " +
            "and what to expect from the shape data. " +
            "Returns all shapes with their name, identifier, type, and resolved configuration. " +
            "Use this to understand the structure and schema of a tenant's content.",
        inputSchema: z.object({
            tenant: z.string().describe("The tenant identifier"),
        }),
        handler: async ({ tenant, authContext }) => {
            const matchedTenant = tenantMatcher(authContext.tenants, { identifier: tenant });
            const client = createClient({
                tenantIdentifier: matchedTenant.identifier,
                tenantId: matchedTenant.id,
                ...authContextResolver.getClientCredentials(authContext),
            });
            try {
                const data = await client.nextPimApi(
                    `query {
                        shapes {
                            edges {
                                node {
                                    name
                                    identifier
                                    type
                                    resolvedConfiguration
                                }
                            }
                        }
                    }`,
                );
                return {
                    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
                };
            } catch (error) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `GraphQL errors:\n${error instanceof Error ? error.message : String(error)}`,
                        },
                    ],
                };
            }
        },
    });
};
