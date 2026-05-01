import z from "zod";
import html from "virtual:app/tenant-overview";
import { defineToolWrapper } from "../../../contracts/tool";

type Deps = {};

export const createTenantOverviewToolWrapper = (_deps: Deps) => {
    return defineToolWrapper({
        description:
            "Display an interactive overview of the Crystallize tenants resolved for this connection. " +
            "Shows tenant name, identifier, ID, and auth type as a UI panel rendered in the host. " +
            "Use this when the user wants to inspect or confirm which tenants are connected.",
        inputSchema: z.object({}),
        annotions: {
            readOnlyHint: true,
        },
        ui: {
            resourceUri: "ui://crystallize/tenant-overview.html",
            name: "Crystallize Tenant Overview",
            description: "Interactive panel listing the tenants resolved for the current MCP connection.",
            html,
        },
        handler: async ({ authContext }) => {
            const payload = {
                authType: authContext.type,
                tenants: authContext.tenants.map((t) => ({
                    id: t.id,
                    identifier: t.identifier,
                    name: t.name,
                    staticAuthToken: Boolean(t.staticAuthToken),
                })),
                fetchedAt: new Date().toISOString(),
            };
            return {
                content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
            };
        },
    });
};
