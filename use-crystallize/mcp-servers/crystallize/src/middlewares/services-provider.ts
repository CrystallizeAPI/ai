import { getMcpAuthContext } from "agents/mcp";
import { createMiddleware } from "hono/factory";
import z from "zod";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { AppContext, AuthContext } from "../contracts/app-context";
import type { AnalyticsRequestContext } from "../contracts/analytics-tracker";
import type { ToolWrapper } from "../contracts/tool";
import { buildContainer, toolRegistry } from "../core/container";
import { buildToolCallEvent } from "../core/analytics";
import { readExposeFlags } from "../core/expose-flags";
import { PLAUSIBLE_EVENTS_ENDPOINT } from "../core/services/plausible-analytics-tracker";
import { asValue } from "awilix";

export const servicesProvider = createMiddleware<AppContext>(async (c, next) => {
    let executionContext: ExecutionContext | undefined;
    try {
        executionContext = c.executionCtx;
    } catch {
        executionContext = undefined;
    }
    const defer = async (promise: Promise<void>) => {
        if (executionContext) {
            executionContext.waitUntil(promise);
        } else {
            await promise;
        }
    };

    const container = buildContainer(c.env);
    const scoped = container.createScope();
    // Registered on the scope, not the container: buildContainer caches a single
    // container for the isolate's lifetime and ignores env, so anything derived
    // from the request (or from c.env) would otherwise be frozen at the first request.
    const analyticsRequestContext: AnalyticsRequestContext = {
        domain: c.env.PLAUSIBLE_DOMAIN,
        endpoint: c.env.PLAUSIBLE_API_ENDPOINT || PLAUSIBLE_EVENTS_ENDPOINT,
        origin: new URL(c.req.url).origin,
        clientIp: c.req.header("CF-Connecting-IP"),
        userAgent: c.req.header("User-Agent"),
    };
    scoped.register({
        defer: asValue(defer),
        analyticsRequestContext: asValue(analyticsRequestContext),
    });

    const mcpServer = scoped.cradle.mcpServer;
    const analyticsTracker = scoped.cradle.analyticsTracker;

    // Writes are off by default — opt in per request, mirroring exposeSkills but
    // with the opposite default so today's read-only behavior is preserved.
    const { write: exposeWrite, ui: exposeUi, skills: exposeSkills } = readExposeFlags((key) => c.req.query(key));
    for (const toolName of Object.keys(toolRegistry) as Array<keyof typeof toolRegistry>) {
        if (!exposeSkills && toolName === "skills") continue;
        const containerKey = toolRegistry[toolName];
        const wrapper = container.cradle[containerKey] as ToolWrapper<z.ZodObject<z.ZodRawShape>>;
        if (!exposeUi && wrapper.ui) continue;
        if (!exposeWrite && wrapper.write) continue;

        const handler = async (input: Record<string, unknown>) => {
            const authContext = getMcpAuthContext();
            if (!authContext) {
                throw new Error("No auth context provided");
            }
            const props = authContext.props as AuthContext;
            // Tracking is fire-and-forget: analyticsTracker returns void and hands
            // delivery to waitUntil, so it cannot delay or fail the tool call.
            analyticsTracker(buildToolCallEvent(toolName, input, props));
            return await wrapper.handler({ ...input, authContext: props });
        };

        if (wrapper.ui) {
            const { resourceUri, name, description, meta, html } = wrapper.ui;
            registerAppTool(
                mcpServer,
                toolName,
                {
                    description: wrapper.description,
                    inputSchema: wrapper.inputSchema,
                    annotations: wrapper.annotations ?? { readOnlyHint: true },
                    _meta: { ui: { resourceUri } },
                },
                handler,
            );
            registerAppResource(
                mcpServer,
                name,
                resourceUri,
                { description, _meta: meta ? { ui: meta } : undefined },
                async () => ({
                    contents: [
                        {
                            uri: resourceUri,
                            mimeType: RESOURCE_MIME_TYPE,
                            text: html,
                            ...(meta ? { _meta: { ui: meta } } : {}),
                        },
                    ],
                }),
            );
        } else {
            mcpServer.registerTool(
                toolName,
                {
                    description: wrapper.description,
                    // @ts-expect-error — wrapper.inputSchema is a zod-v4 ZodObject from the project's
                    // zod (4.4.3), but the SDK's registerTool types inputSchema against `AnySchema`
                    // from its own nested zod (4.3.6); the two $ZodType identities don't match
                    // nominally. Runtime is correct — getZodSchemaObject() accepts the ZodObject as-is.
                    // Removing the duplicate zod (single version tree-wide) makes this directive unused.
                    inputSchema: wrapper.inputSchema,
                    annotations: wrapper.annotations ?? { readOnlyHint: true },
                },
                handler,
            );
        }
    }

    c.set("services", {
        mcpServer,
        tenantMatcher: scoped.cradle.tenantMatcher,
        analyticsTracker,
    });

    await next();
});
