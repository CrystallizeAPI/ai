import { getMcpAuthContext } from "agents/mcp";
import { createMiddleware } from "hono/factory";
import z from "zod";
import { AppContext, AuthContext } from "../contracts/app-context";
import type { ToolWrapper } from "../contracts/tool";
import { buildContainer, toolRegistry } from "../core/container";
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
    scoped.register({
        defer: asValue(defer),
    });

    const mcpServer = scoped.cradle.mcpServer;

    const exposeSkills = c.req.query("exposeSkills") !== "false";
    for (const toolName of Object.keys(toolRegistry) as Array<keyof typeof toolRegistry>) {
        if (!exposeSkills && toolName === "skills") continue;
        const containerKey = toolRegistry[toolName];
        const wrapper = container.cradle[containerKey] as ToolWrapper<z.ZodObject<z.ZodRawShape>>;
        mcpServer.registerTool(
            toolName,
            {
                description: wrapper.description,
                inputSchema: wrapper.inputSchema,
                annotations: {
                    readOnlyHint: true,
                },
            },
            async (input) => {
                const authContext = getMcpAuthContext();
                if (!authContext) {
                    throw new Error("No auth context provided");
                }
                return await wrapper.handler({ ...input, authContext: authContext.props as AuthContext });
            },
        );
    }

    c.set("services", {
        mcpServer,
        tenantMatcher: scoped.cradle.tenantMatcher,
    });

    await next();
});
