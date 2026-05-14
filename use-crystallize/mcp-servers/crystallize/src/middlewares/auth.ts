import { createMiddleware } from "hono/factory";
import type { AppContext, AuthContext } from "../contracts/app-context";
import { createClient } from "@crystallize/js-api-client";
import { getCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

const meQuery = `query { me { tenants { tenant { id name identifier staticAuthToken } } } }`;

const JWKS_URL = new URL("https://api.crystallize.com/.well-known/jwks.json");
const JWKS = createRemoteJWKSet(JWKS_URL, { timeoutDuration: 15_000, cooldownDuration: 30_000 });

type BearerClaims = JWTPayload & {
    act?: {
        tenantId?: string;
        [key: string]: unknown;
    };
};

const extractBearerToken = (header: string | undefined): string | undefined => {
    if (!header) return undefined;
    const match = header.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
};

export const authMiddleware = createMiddleware<AppContext>(async (c, next) => {
    const accessTokenId = c.req.header("X-Crystallize-Access-Token-Id");
    const accessTokenSecret = c.req.header("X-Crystallize-Access-Token-Secret");
    const sessionId = getCookie(c, "connect.sid") ?? c.req.header("X-Crystallize-Session-Id");
    const bearerToken = extractBearerToken(c.req.header("Authorization"));

    if (!sessionId && !bearerToken && (!accessTokenId || !accessTokenSecret)) {
        return c.json(
            {
                error: "Unauthorized: provide X-Crystallize-Access-Token-Id/Secret headers, an Authorization: Bearer <jwt> header, or a connect.sid cookie",
            },
            403,
        );
    }

    if (bearerToken && !sessionId) {
        const tenantIdentifier = c.req.header("X-Crystallize-Tenant-Identifier");
        if (!tenantIdentifier) {
            return c.json(
                { error: "Unauthorized: bearer auth requires the X-Crystallize-Tenant-Identifier header" },
                403,
            );
        }

        let claims: BearerClaims;
        try {
            const { payload } = await jwtVerify<BearerClaims>(bearerToken, JWKS, { algorithms: ["RS256"] });
            claims = payload;
        } catch {
            return c.json({ error: "Unauthorized: bearer token signature is invalid or expired" }, 403);
        }

        const tenantId = claims.act?.tenantId;
        if (!tenantId) {
            return c.json({ error: "Unauthorized: bearer token is missing act.tenantId" }, 403);
        }

        c.set("authContext", {
            type: "bearer",
            bearerToken,
            tenants: [{ id: tenantId, identifier: tenantIdentifier, name: tenantIdentifier }],
        });
        await next();
        return;
    }

    const credentials = sessionId ? { sessionId } : { accessTokenId, accessTokenSecret };

    const client = createClient({
        tenantIdentifier: "dummy",
        ...credentials,
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
