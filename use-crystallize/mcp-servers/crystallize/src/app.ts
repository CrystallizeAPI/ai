import { Hono } from "hono";
import type { AppContext } from "./contracts/app-context";
import { servicesProvider } from "./middlewares/services-provider";
import { authMiddleware } from "./middlewares/auth";
import { createMcpHandler } from "agents/mcp/server";
import { landingPage } from "./pages/landing";
import { buildSessionEvent } from "./core/analytics";
import { readExposeFlags } from "./core/expose-flags";
import { isSessionStartRequest } from "./core/mcp-request";
import { PLAUSIBLE_EVENTS_ENDPOINT } from "./core/services/plausible-analytics-tracker";
import { protectedResourceMetadata, tenantFromMcpPath, type OAuthEnv } from "./core/oauth";

export const createApp = () => {
    const app = new Hono<AppContext>();
    app.use(servicesProvider);
    app.get("/.well-known/oauth-protected-resource/mcp/:tenant{@[^/]+}", (c) =>
        c.json(protectedResourceMetadata(c.req.url, c.req.param("tenant").slice(1), c.env as OAuthEnv)),
    );
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
        const isSessionStart = await isSessionStartRequest(c.req.raw);
        // One endpoint, both protocol eras: 2026-07-28 clients are served natively, and 2025 clients (the
        // `initialize` handshake) fall back to stateless serving (`legacy: "stateless"`, the default).
        // The server is already built per request by `servicesProvider`, so the factory just hands it over.
        const mcpServer = c.get("services").mcpServer;
        const handler = createMcpHandler(() => mcpServer, {
            // `/mcp`, or `/mcp/@<tenant>` for OAuth clients (the handler matches its route exactly)
            route: tenantFromMcpPath(new URL(c.req.url).pathname) ? new URL(c.req.url).pathname : "/mcp",
            authContext: {
                props: c.get("authContext"),
            },
            responseMode: "json",
        });
        const response = await handler(c.req.raw, c.env, c.executionCtx);
        if (isSessionStart && response.ok) {
            c.get("services").analyticsTracker(
                buildSessionEvent(readExposeFlags((key) => c.req.query(key)), c.get("authContext")),
            );
        }
        return response;
    });
    return app;
};
