import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

const mockCreateClient = mock();
mock.module("@crystallize/js-api-client", () => {
    const actual = require("@crystallize/js-api-client");
    return { ...actual, createClient: mockCreateClient };
});

import { createQueryShopCartToolWrapper } from "../../../../src/core/mcp/tools/query-shop-cart";
import { createTenantMatcher } from "../../../../src/core/services/tenant-matcher";
import { createAuthContextResolver } from "../../../../src/core/services/auth-context-helpers";
import type { QueryExecutor } from "../../../../src/contracts/query-executor";
import { testAuthContext } from "../../../utils/fixtures";

describe("query-shop-cart", () => {
    let fetchSpy: ReturnType<typeof spyOn>;
    let queryExecutor: ReturnType<typeof mock>;
    let tool: ReturnType<typeof createQueryShopCartToolWrapper>;
    const dev = { ...testAuthContext, origin: "-dev.example.test" };
    const run = () => tool.handler({ tenant: "shop", query: "{ cart(id: \"c1\") { id } }", authContext: dev });

    beforeEach(() => {
        fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ success: true, token: "shop-token" }), { status: 200 }),
        );
        mockCreateClient.mockReset();
        mockCreateClient.mockReturnValue({ shopCartApi: mock() });
        queryExecutor = mock(async () => ({ content: [{ type: "text", text: "{}" }] }));
        tool = createQueryShopCartToolWrapper({
            tenantMatcher: createTenantMatcher(),
            queryExecutor: queryExecutor as unknown as QueryExecutor,
            authContextResolver: createAuthContextResolver(),
        });
    });

    afterEach(() => {
        fetchSpy.mockRestore();
    });

    it("exchanges the shop token on the auth context's environment", async () => {
        await run();
        expect(fetchSpy.mock.calls[0][0]).toBe("https://shop-api-dev.example.test/@shop/auth/token");
    });

    it("creates the client on the auth context's environment", async () => {
        await run();
        expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ origin: "-dev.example.test" }));
    });

    it("introspects the Shop Cart API of the auth context's environment", async () => {
        await run();
        expect(queryExecutor.mock.calls[0][0]).toMatchObject({
            introspectionUrl: "https://shop-api-dev.example.test/@shop/cart",
        });
    });
});
