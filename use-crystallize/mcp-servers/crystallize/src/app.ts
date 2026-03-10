import { Hono } from "hono";
import type { AppContext } from "./contracts/app-context";
import { servicesProvider } from "./middlewares/services-provider";
import { authMiddleware } from "./middlewares/auth";
import { createMcpHandler } from "agents/mcp";
import { landingPage } from "./pages/landing";

export const createApp = () => {
    const app = new Hono<AppContext>();
    app.use(servicesProvider);
    app.get("/", (c) => c.html(landingPage()));

    app.all("/mcp/*", authMiddleware, async (c) => {
        const handler = createMcpHandler(c.get("services").mcpServer, {
            route: "/mcp",
            authContext: {
                props: c.get("authContext"),
            },
            enableJsonResponse: true,
        });
        return handler(c.req.raw, c.env, c.executionCtx);
    });
    return app;
};
