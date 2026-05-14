import { describe, it, expect, mock, beforeEach } from "bun:test";
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
        const res = await app.request("/test");
        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("Unauthorized");
    });

    it("returns 403 when only one header is provided", async () => {
        const res = await app.request("/test", {
            headers: { "X-Crystallize-Access-Token-Id": "some-id" },
        });
        expect(res.status).toBe(403);
    });

    it("returns 403 when pimApi returns empty tenants", async () => {
        const mockPimApi = mock().mockResolvedValue({ me: { tenants: [] } });
        mockCreateClient.mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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
        const res = await app.request("/test", {
            headers: { Authorization: "Bearer my-jwt-token" },
        });

        expect(res.status).toBe(403);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("X-Crystallize-Tenant-Identifier");
        expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it("rejects bearer when the signature is invalid", async () => {
        mockJwtVerify.mockRejectedValue(new Error("signature verification failed"));

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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
        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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

        const res = await app.request("/test", {
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
});
