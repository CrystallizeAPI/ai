import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

vi.mock("@crystallize/js-api-client", () => ({
    createClient: vi.fn(),
}));

import { createClient } from "@crystallize/js-api-client";
import { authMiddleware } from "../../src/middlewares/auth";

describe("authMiddleware", () => {
    let app: Hono;

    beforeEach(() => {
        vi.clearAllMocks();
        app = new Hono();
        app.use("/*", authMiddleware as never);
        app.get("/test", (c) => {
            const authContext = c.get("authContext" as never);
            return c.json({ ok: true, authContext });
        });
    });

    it("returns 401 when headers are missing", async () => {
        const res = await app.request("/test");
        expect(res.status).toBe(401);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("Unauthorized");
    });

    it("returns 401 when only one header is provided", async () => {
        const res = await app.request("/test", {
            headers: { "X-Crystallize-Access-Token-Id": "some-id" },
        });
        expect(res.status).toBe(401);
    });

    it("returns 401 when pimApi returns empty tenants", async () => {
        const mockPimApi = vi.fn().mockResolvedValue({ me: { tenants: [] } });
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await app.request("/test", {
            headers: {
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(401);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("invalid credentials");
    });

    it("returns 401 when pimApi returns null", async () => {
        const mockPimApi = vi.fn().mockResolvedValue(null);
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

        const res = await app.request("/test", {
            headers: {
                "X-Crystallize-Access-Token-Id": "test-id",
                "X-Crystallize-Access-Token-Secret": "test-secret",
            },
        });

        expect(res.status).toBe(401);
    });

    it("sets authContext and proceeds on valid token", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop", staticAuthToken: "tok" } }];
        const mockPimApi = vi.fn().mockResolvedValue({ me: { tenants: tenantData } });
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

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
        const mockPimApi = vi.fn().mockResolvedValue({ me: { tenants: tenantData } });
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

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

        expect(vi.mocked(createClient)).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "my-session-id" }));
    });

    it("sets session authContext when X-Crystallize-Session-Id header is provided", async () => {
        const tenantData = [{ tenant: { id: "t1", identifier: "shop", name: "Shop" } }];
        const mockPimApi = vi.fn().mockResolvedValue({ me: { tenants: tenantData } });
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

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
        const mockPimApi = vi.fn().mockResolvedValue({ me: { tenants: tenantData } });
        vi.mocked(createClient).mockReturnValue({ pimApi: mockPimApi } as never);

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
});
