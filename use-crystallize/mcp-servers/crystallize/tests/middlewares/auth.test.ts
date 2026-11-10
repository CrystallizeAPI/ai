import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Hono } from "hono";

const mockCreateClient = mock();
mock.module("@crystallize/js-api-client", () => ({
    createClient: mockCreateClient,
}));

const mockJwtVerify = mock();
const mockCreateRemoteJWKSet = mock(() => ({}));
mock.module("jose", () => ({
    createRemoteJWKSet: mockCreateRemoteJWKSet,
    jwtVerify: mockJwtVerify,
}));

import { authMiddleware } from "../../src/middlewares/auth";

describe("authMiddleware", () => {
    let app: Hono;
    // A Worker always has an env, but `app.request` without one leaves `c.env` undefined.
    const request = (input: string, init?: RequestInit, env: Record<string, string> = {}) =>
        app.request(input, init, env);

    beforeEach(() => {
        mockCreateClient.mockReset();
        mockJwtVerify.mockReset();
        app = new Hono();
        app.use("/*", authMiddleware as never);
        app.get("/test", (c) => {
            const authContext = c.get("authContext" as never);
            return c.json({ ok: true, authContext });
        });
    });

    it("returns 403 when headers are missing", async () => {
        const res = await request("/test");
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("Unauthorized");
    });

    it("returns 403 when only one header is provided", async () => {
        const res = await request("/test", {
            headers: { "X-Crystallize-Access-Token-Id": "some-id" },
        });
        expect(res.status).toBe(403);
    });

    it("returns 403 when pimApi returns empty tenants", async () => {
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: [] } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("invalid credentials");
    });

    it("returns 403 when pimApi returns null", async () => {
        const mockPimApi = mock().mockResolvedValue(null);
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(403);
    });

    it("sets authContext and proceeds on valid token", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop", staticAuthToken: "tok" } }];
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            ok: boolean;
            authContext: { type: string; accessTokenId: string; tenants: { identifier: string }[] };
        };
        expect(body.ok).toBe(true);
        expect(body.authContext.type).toBe("token");
        expect(body.authContext.accessTokenId).toBe("test-id");
        expect(body.authContext.tenants).toHaveLength(1);
        expect(body.authContext.tenants[0].identifier).toBe("shop");
    });

    it("sets session authContext when connect.sid cookie is provided", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                Cookie: "connect.sid=my-session-id",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            ok: boolean;
            authContext: { type: string; sessionId: string; tenants: { identifier: string }[] };
        };
        expect(body.ok).toBe(true);
        expect(body.authContext.type).toBe("session");
        expect(body.authContext.sessionId).toBe("my-session-id");
        expect(body.authContext.tenants).toHaveLength(1);

        expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "my-session-id" }));
    });

    it("sets session authContext when X-Crystallize-Session-Id header is provided", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                "X-Crystallize-Session-Id": "header-session-id",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            ok: boolean;
            authContext: { type: string; sessionId: string };
        };
        expect(body.authContext.type).toBe("session");
        expect(body.authContext.sessionId).toBe("header-session-id");
    });

    it("prefers session over token headers when both are provided", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                Cookie: "connect.sid=my-session-id",
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            ok: boolean;
            authContext: { type: string; sessionId: string };
        };
        expect(body.authContext.type).toBe("session");
        expect(body.authContext.sessionId).toBe("my-session-id");
    });

    it("verifies the JWT signature and builds bearer authContext from claims + tenant header", async () => {
        mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);

        const res = await request("/test", {
            headers: {
                Authorization: "Bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            authContext: {
                type: string;
                bearerToken: string;
                tenants: { id: string; identifier: string; name: string }[];
            };
        };
        expect(body.authContext.type).toBe("bearer");
        expect(body.authContext.bearerToken).toBe("my-jwt-token");
        expect(body.authContext.tenants).toEqual([{ id: "t42", identifier: "shop", name: "shop" }]);

        expect(mockJwtVerify).toHaveBeenCalledWith("my-jwt-token", expect.anything(), { algorithms: ["RS256"] });
        // No PIM round-trip on the bearer path.
        expect(mockCreateClient).not.toHaveBeenCalled();
    });

    it("accepts lowercase 'bearer' scheme in the Authorization header", async () => {
        mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);

        const res = await request("/test", {
            headers: {
                Authorization: "bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { authContext: { type: string; bearerToken: string } };
        expect(body.authContext.type).toBe("bearer");
        expect(body.authContext.bearerToken).toBe("my-jwt-token");
    });

    it("rejects bearer when X-Crystallize-Tenant-Identifier is missing", async () => {
        const res = await request("/test", {
            headers: { Authorization: "Bearer my-jwt-token" },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("X-Crystallize-Tenant-Identifier");
        expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it("rejects bearer when the signature is invalid", async () => {
        mockJwtVerify.mockRejectedValue(new Error("signature verification failed"));

        const res = await request("/test", {
            headers: {
                Authorization: "Bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
            },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("signature is invalid");
    });

    it("rejects bearer when act.tenantId is missing from claims", async () => {
        mockJwtVerify.mockResolvedValue({ payload: { act: {} } } as never);

        const res = await request("/test", {
            headers: {
                Authorization: "Bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
            },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("act.tenantId");
    });

    it("ignores Authorization header without a Bearer scheme", async () => {
        const res = await request("/test", {
            headers: {
                Authorization: "Basic dXNlcjpwYXNz",
            },
        });
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("Unauthorized");
    });

    it("prefers session over bearer when both are provided", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await request("/test", {
            headers: {
                Cookie: "connect.sid=my-session-id",
                Authorization: "Bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { authContext: { type: string; sessionId: string } };
        expect(body.authContext.type).toBe("session");
        expect(body.authContext.sessionId).toBe("my-session-id");
        expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it("prefers bearer over token headers when both are provided", async () => {
        mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);

        const res = await request("/test", {
            headers: {
                Authorization: "Bearer my-jwt-token",
                "X-Crystallize-Tenant-Identifier": "shop",
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as { authContext: { type: string; bearerToken: string } };
        expect(body.authContext.type).toBe("bearer");
        expect(body.authContext.bearerToken).toBe("my-jwt-token");
        expect(mockCreateClient).not.toHaveBeenCalled();
    });

    describe("environment selection", () => {
        const tokenHeaders = {
            "X-Crystallize-Access-Token-Id": "test-id",
            "X-Crystallize-Access-Token-Secret": "test-secret",
        };
        const env = { CRYSTALLIZE_DEV_API_ORIGIN: "-dev.example.test" };
        const okMe = () => {
            const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
            const pimApi = mock().mockResolvedValue({ me: { tenants: tenantData } });
            mockCreateClient.mockReturnValue({ pimApi } as never);
        };
        const jwksHrefs = () => mockCreateRemoteJWKSet.mock.calls.map((call) => (call as unknown as [URL])[0].href);
        const bearerDev = () =>
            request(
                "/test",
                {
                    headers: {
                        Authorization: "Bearer my-jwt-token",
                        "X-Crystallize-Tenant-Identifier": "shop",
                        "X-Crystallize-Environment": "dev",
                    },
                },
                env,
            );

        it("resolves X-Crystallize-Environment: dev into authContext.origin and the me-call client", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: { ...tokenHeaders, "X-Crystallize-Environment": "dev" } },
                env,
            );

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe("-dev.example.test");
            expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ origin: "-dev.example.test" }));
        });

        it("defaults authContext.origin to production without the header", async () => {
            okMe();
            const res = await request("/test", { headers: tokenHeaders }, env);

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe(".crystallize.com");
            expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ origin: ".crystallize.com" }));
        });

        it("defaults to dev without the header when CRYSTALLIZE_DEFAULT_ENVIRONMENT is dev", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: tokenHeaders },
                { ...env, CRYSTALLIZE_DEFAULT_ENVIRONMENT: "dev" },
            );

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe("-dev.example.test");
            expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ origin: "-dev.example.test" }));
        });

        it("lets X-Crystallize-Environment: production override a dev default", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: { ...tokenHeaders, "X-Crystallize-Environment": "production" } },
                { ...env, CRYSTALLIZE_DEFAULT_ENVIRONMENT: "dev" },
            );

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe(".crystallize.com");
        });

        it("returns 500 before contacting Crystallize when the dev default has no dev secret", async () => {
            okMe();
            const res = await request("/test", { headers: tokenHeaders }, { CRYSTALLIZE_DEFAULT_ENVIRONMENT: "dev" });

            expect(res.status).toBe(500);
            expect(mockCreateClient).not.toHaveBeenCalled();
        });

        it("never lets a bad dev secret affect production requests", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: tokenHeaders },
                { CRYSTALLIZE_DEV_API_ORIGIN: "dev.example.test/evil" },
            );

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe(".crystallize.com");
        });

        it("rejects an unknown environment with 400 before contacting Crystallize", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: { ...tokenHeaders, "X-Crystallize-Environment": "staging" } },
                env,
            );

            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain("X-Crystallize-Environment");
            expect(mockCreateClient).not.toHaveBeenCalled();
        });

        it("rejects dev with 400 when CRYSTALLIZE_DEV_API_ORIGIN is unset", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: { ...tokenHeaders, "X-Crystallize-Environment": "dev" } },
                {},
            );

            expect(res.status).toBe(400);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain("not configured");
            expect(mockCreateClient).not.toHaveBeenCalled();
        });

        it("returns 500 when CRYSTALLIZE_DEV_API_ORIGIN is not a valid suffix", async () => {
            okMe();
            const res = await request(
                "/test",
                { headers: { ...tokenHeaders, "X-Crystallize-Environment": "dev" } },
                { CRYSTALLIZE_DEV_API_ORIGIN: "dev.example.test/evil" },
            );

            expect(res.status).toBe(500);
            const body = (await res.json()) as { error: string };
            expect(body.error).toContain("CRYSTALLIZE_DEV_API_ORIGIN");
            expect(mockCreateClient).not.toHaveBeenCalled();
        });

        it("verifies dev bearer tokens against the dev environment's JWKS", async () => {
            mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);
            const res = await bearerDev();

            expect(res.status).toBe(200);
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe("-dev.example.test");
            expect(jwksHrefs()).toContain("https://api-dev.example.test/.well-known/jwks.json");
        });

        it("verifies production bearer tokens against api.crystallize.com", async () => {
            mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);
            const res = await request("/test", {
                headers: { Authorization: "Bearer my-jwt-token", "X-Crystallize-Tenant-Identifier": "shop" },
            });

            expect(res.status).toBe(200);
            expect(jwksHrefs()).toContain("https://api.crystallize.com/.well-known/jwks.json");
        });

        it("builds one JWKS per environment and reuses it", async () => {
            mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);
            await bearerDev();
            await bearerDev();

            const devHref = "https://api-dev.example.test/.well-known/jwks.json";
            expect(jwksHrefs().filter((href) => href === devHref)).toHaveLength(1);
        });
    });

    describe("OAuth (MCP authorization)", () => {
        const env = { CRYSTALLIZE_OAUTH_API_URL: "https://api-dev.example.test/" };
        const oauthHeaders = { Authorization: "Bearer crz_oat_abc" };
        const tenants = [{ id: "t1", identifier: "shop", name: "Shop", scopes: ["orders:read"] }];
        const originalFetch = globalThis.fetch;
        let mockFetch: ReturnType<typeof mock>;

        beforeEach(() => {
            mockFetch = mock();
            globalThis.fetch = mockFetch as unknown as typeof fetch;
        });
        afterEach(() => {
            globalThis.fetch = originalFetch;
        });

        const respond = (status: number, body: unknown = {}) =>
            mockFetch.mockResolvedValue(new Response(JSON.stringify(body), { status }));

        it("challenges a request without credentials with the resource metadata", async () => {
            const res = await app.request("http://mcp.example.test/test", {}, env);

            expect(res.status).toBe(401);
            expect(res.headers.get("WWW-Authenticate")).toBe(
                'Bearer resource_metadata="http://mcp.example.test/.well-known/oauth-protected-resource/mcp"',
            );
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it("keeps the 403 for missing credentials when OAuth is not configured", async () => {
            const res = await app.request("/test", {}, {});

            expect(res.status).toBe(403);
            expect(res.headers.get("WWW-Authenticate")).toBeNull();
        });

        it("acts as the user on the tenants the Core API returns for the token", async () => {
            respond(200, { tenants });
            const res = await app.request("/test", { headers: oauthHeaders }, env);

            expect(res.status).toBe(200);
            expect(mockFetch).toHaveBeenCalledWith("https://api-dev.example.test/oauth-grant/tenants", {
                headers: { Accept: "application/json", Authorization: "Bearer crz_oat_abc" },
            });
            const body = (await res.json()) as { authContext: Record<string, unknown> };
            expect(body.authContext).toEqual({
                type: "bearer",
                bearerToken: "crz_oat_abc",
                origin: "-dev.example.test",
                tenants: [{ id: "t1", identifier: "shop", name: "Shop" }],
            });
            expect(mockJwtVerify).not.toHaveBeenCalled();
            expect(mockCreateClient).not.toHaveBeenCalled();
        });

        it("uses the token's environment, not X-Crystallize-Environment", async () => {
            respond(200, { tenants });
            const res = await app.request(
                "/test",
                { headers: { ...oauthHeaders, "X-Crystallize-Environment": "production" } },
                env,
            );

            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe("-dev.example.test");
        });

        it("falls back to the request's environment for a local Core API", async () => {
            respond(200, { tenants });
            const res = await app.request(
                "/test",
                { headers: oauthHeaders },
                { CRYSTALLIZE_OAUTH_API_URL: "http://localhost:3001" },
            );

            expect(mockFetch).toHaveBeenCalledWith("http://localhost:3001/oauth-grant/tenants", expect.anything());
            const body = (await res.json()) as { authContext: { origin: string } };
            expect(body.authContext.origin).toBe(".crystallize.com");
        });

        it.each([401, 403])("answers invalid_token when the Core API refuses the token (%i)", async (status) => {
            respond(status);
            const res = await app.request("http://mcp.example.test/test", { headers: oauthHeaders }, env);

            expect(res.status).toBe(401);
            expect(res.headers.get("WWW-Authenticate")).toBe(
                'Bearer resource_metadata="http://mcp.example.test/.well-known/oauth-protected-resource/mcp", error="invalid_token"',
            );
        });

        it("answers 503 when the Core API cannot be reached", async () => {
            mockFetch.mockRejectedValue(new TypeError("fetch failed"));
            const unreachable = await app.request("/test", { headers: oauthHeaders }, env);
            respond(500);
            const failing = await app.request("/test", { headers: oauthHeaders }, env);

            expect(unreachable.status).toBe(503);
            expect(failing.status).toBe(503);
        });

        it("refuses a user without tenants", async () => {
            respond(200, { tenants: [] });
            const res = await app.request("/test", { headers: oauthHeaders }, env);

            expect(res.status).toBe(403);
        });

        it("leaves plugin JWT bearer tokens to the JWKS check", async () => {
            mockJwtVerify.mockResolvedValue({ payload: { act: { tenantId: "t42" } } } as never);
            const res = await app.request(
                "/test",
                { headers: { Authorization: "Bearer my-jwt-token", "X-Crystallize-Tenant-Identifier": "shop" } },
                env,
            );

            expect(res.status).toBe(200);
            expect(mockFetch).not.toHaveBeenCalled();
        });
    });
});
