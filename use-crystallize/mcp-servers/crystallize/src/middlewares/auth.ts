import { createMiddleware } from "hono/factory";
import type { AppContext, AuthContext } from "../contracts/app-context";
import { createClient } from "@crystallize/js-api-client";

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
    const accessTokenId = c.req.header("X-Crystallize-Access-Token-Id");
    const accessTokenSecret = c.req.header("X-Crystallize-Access-Token-Secret");

    if (!accessTokenId || !accessTokenSecret) {
        return c.json(
            {
                error: "Unauthorized: missing X-Crystallize-Access-Token-Id or X-Crystallize-Access-Token-Secret headers",
            },
            401,
        );
    }
    const client = createClient({
        tenantIdentifier: "dummy", // Tenant identifier is required but not used for authentication validation here
        accessTokenId,
        accessTokenSecret,
    });

    const response = await client.pimApi<{
        me: {
            tenants: Array<{
                tenant: AuthContext["tenants"][number];
            }>;
        };
    }>(`query { me { tenants { tenant { id name identifier staticAuthToken } } } }`);

    if (!response || !response.me || !response.me.tenants || response.me.tenants.length === 0) {
        return c.json({ error: "Unauthorized: invalid access token" }, 401);
    }

    c.set("authContext", {
        accessTokenId,
        accessTokenSecret,
        tenants: response.me.tenants.map((t) => t.tenant),
    });
    await next();
});
