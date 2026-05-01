import { createMiddleware } from "hono/factory";
import type { AppContext, AuthContext } from "../contracts/app-context";
import { createClient } from "@crystallize/js-api-client";
import { getCookie } from "hono/cookie";

const meQuery = `query { me { tenants { tenant { id name identifier staticAuthToken } } } }`;

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
    const accessTokenId = c.req.header("X-Crystallize-Access-Token-Id");
    const accessTokenSecret = c.req.header("X-Crystallize-Access-Token-Secret");
    const sessionId = getCookie(c, "connect.sid") ?? c.req.header("X-Crystallize-Session-Id");

    if (!sessionId && (!accessTokenId || !accessTokenSecret)) {
        return c.json(
            {
                error: "Unauthorized: provide X-Crystallize-Access-Token-Id/Secret headers or a connect.sid cookie",
            },
            403,
        );
    }

    const client = createClient({
        tenantIdentifier: "dummy",
        ...(sessionId ? { sessionId } : { accessTokenId, accessTokenSecret }),
    });

    try {
        const response = await client.pimApi<{
            me: {
                tenants: Array<{
                    tenant: AuthContext["tenants"][number];
                }>;
            };
        }>(meQuery);

        if (!response || !response.me || !response.me.tenants || response.me.tenants.length === 0) {
            return c.json({ error: "Unauthorized: invalid credentials" }, 403);
        }

        const tenants = response.me.tenants.map((t) => t.tenant);

        if (sessionId) {
            c.set("authContext", { type: "session", sessionId, tenants });
        } else {
            c.set("authContext", {
                type: "token",
                accessTokenId: accessTokenId!,
                accessTokenSecret: accessTokenSecret!,
                tenants,
            });
        }
        await next();
    } catch {
        return c.json({ error: "Unauthorized: authentication failed" }, 403);
    }
});
