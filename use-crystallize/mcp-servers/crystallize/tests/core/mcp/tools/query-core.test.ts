import { describe, it, expect, mock, beforeEach } from "bun:test";

const mockCreateClient = mock();
mock.module("@crystallize/js-api-client", () => {
    const actual = require("@crystallize/js-api-client");
    return { ...actual, createClient: mockCreateClient };
});

import { createQueryCoreToolWrapper } from "../../../../src/core/mcp/tools/query-core";
import { createTenantMatcher } from "../../../../src/core/services/tenant-matcher";
import { createAuthContextResolver } from "../../../../src/core/services/auth-context-helpers";
import type { QueryExecutor } from "../../../../src/contracts/query-executor";
import { testAuthContext } from "../../../utils/fixtures";

describe("query-core", () => {
    let queryExecutor: ReturnType<typeof mock>;
    let tool: ReturnType<typeof createQueryCoreToolWrapper>;
    const dev = { ...testAuthContext, origin: "-dev.example.test" };

    beforeEach(() => {
        mockCreateClient.mockReset();
        mockCreateClient.mockReturnValue({ nextPimApi: mock() });
        queryExecutor = mock(async () => ({ content: [{ type: "text", text: "{}" }] }));
        tool = createQueryCoreToolWrapper({
            tenantMatcher: createTenantMatcher(),
            queryExecutor: queryExecutor as unknown as QueryExecutor,
            authContextResolver: createAuthContextResolver(),
        });
    });

    it("creates the client on the auth context's environment", async () => {
        await tool.handler({ tenant: "shop", query: "{ me { id } }", authContext: dev });
        expect(mockCreateClient).toHaveBeenCalledWith(expect.objectContaining({ origin: "-dev.example.test" }));
    });

    it("introspects the Core API of the auth context's environment", async () => {
        await tool.handler({ tenant: "shop", query: "{ me { id } }", authContext: dev });
        expect(queryExecutor.mock.calls[0][0]).toMatchObject({
            introspectionUrl: "https://api-dev.example.test/@shop",
        });
    });
});
