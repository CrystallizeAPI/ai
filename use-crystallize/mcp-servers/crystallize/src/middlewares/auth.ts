import { createMiddleware } from "hono/factory";
import type { AppContext, AuthContext } from "../contracts/app-context";
import { createClient } from "@crystallize/js-api-client";
import { getCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { apiBaseUrl, ENVIRONMENT_HEADER, resolveApiOrigin } from "../core/api-origin";

const meQuery = `query { me { tenants { tenant { id name identifier staticAuthToken } } } }`;

// One remote JWKS per environment: a bearer token is signed by the environment that issued it. Built lazily and
// kept for the isolate's lifetime, like the single production JWKS used to be.
const jwksByOrigin = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const jwksFor = (origin: string) => {
    let jwks = jwksByOrigin.get(origin);
    if (!jwks) {
        const url = new URL(`${apiBaseUrl("api", origin)}/.well-known/jwks.json`);
        jwks = createRemoteJWKSet(url, { timeoutDuration: 15_000, cooldownDuration: 30_000 });
        jwksByOrigin.set(origin, jwks);
    }
    return jwks;
};

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
    // Resolved before any credential check: the credential is only meaningful on its own environment, and both
    // the JWKS lookup and the `me` call below have to target it. The secret is only read when a request asks for
    // dev, so a bad secret can never take production traffic down.
    const environment = c.req.header(ENVIRONMENT_HEADER);
    const resolved = resolveApiOrigin(environment, environment ? c.env.CRYSTALLIZE_DEV_API_ORIGIN : undefined);
    if (!resolved.ok) {
        return c.json({ error: resolved.error }, resolved.status);
    }
    const origin = resolved.origin;

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
            const { payload } = await jwtVerify<BearerClaims>(bearerToken, jwksFor(origin), {
                algorithms: ["RS256"],
            });
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
            origin,
            tenants: [{ id: tenantId, identifier: tenantIdentifier, name: tenantIdentifier }],
        });
        await next();
        return;
    }

    const credentials = sessionId ? { sessionId } : { accessTokenId, accessTokenSecret };

    const client = createClient({
        tenantIdentifier: "dummy",
        origin,
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
            c.set("authContext", { type: "session", sessionId, origin, tenants });
        } else {
            c.set("authContext", {
                type: "token",
                accessTokenId: accessTokenId!,
                accessTokenSecret: accessTokenSecret!,
                origin,
                tenants,
            });
        }
        await next();
    } catch {
        return c.json({ error: "Unauthorized: authentication failed" }, 403);
    }
});
