import { Hono } from "hono";
import type { AppContext } from "./contracts/app-context";
import { servicesProvider } from "./middlewares/services-provider";
import { authMiddleware } from "./middlewares/auth";
import { createMcpHandler } from "agents/mcp";
import { landingPage } from "./pages/landing";
import { buildSessionEvent } from "./core/analytics";
import { readExposeFlags } from "./core/expose-flags";
import { isInitializeRequest } from "./core/mcp-request";
import { PLAUSIBLE_EVENTS_ENDPOINT } from "./core/services/plausible-analytics-tracker";

export const createApp = () => {
    const app = new Hono<AppContext>();
    app.use(servicesProvider);
    app.get("/", (c) =>
        c.html(
            landingPage({
                plausibleScriptUrl: c.env.PLAUSIBLE_SCRIPT_URL,
                plausibleEndpoint: c.env.PLAUSIBLE_API_ENDPOINT || PLAUSIBLE_EVENTS_ENDPOINT,
            }),
        ),
    );

    app.all("/mcp/*", authMiddleware, async (c) => {
        // Detected before the handler consumes the body, but only *counted* after
        // it answers: this route pattern is wider than the handler's own `route`,
        // and the transport rejects bad Accept/Content-Type. A client looping
        // against a trailing-slash URL would otherwise inflate the session count
        // with handshakes that only ever got a 404.
        const isHandshake = await isInitializeRequest(c.req.raw);
        const handler = createMcpHandler(c.get("services").mcpServer, {
            route: "/mcp",
            authContext: {
                props: c.get("authContext"),
            },
            enableJsonResponse: true,
        });
        const response = await handler(c.req.raw, c.env, c.executionCtx);
        if (isHandshake && response.ok) {
            c.get("services").analyticsTracker(
                buildSessionEvent(readExposeFlags((key) => c.req.query(key)), c.get("authContext")),
            );
        }
        return response;
    });
    return app;
};
