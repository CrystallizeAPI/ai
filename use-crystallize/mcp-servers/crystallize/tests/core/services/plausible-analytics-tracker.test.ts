import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import { createPlausibleAnalyticsTracker } from "../../../src/core/services/plausible-analytics-tracker";
import type { AnalyticsRequestContext } from "../../../src/contracts/analytics-tracker";

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

const okResponse = () => new Response(null, { status: 202 });
const droppedResponse = () => new Response(null, { status: 202, headers: { "x-plausible-dropped": "1" } });

const baseContext: AnalyticsRequestContext = {
    domain: "mcp.crystallize.com",
    endpoint: "https://plausible.io/api/event",
    origin: "https://mcp.crystallize.com",
    clientIp: "203.0.113.7",
    userAgent: "claude-code/1.2.3",
};

/** Collects the promises handed to waitUntil so tests can await delivery. */
const makeDefer = () => {
    const pending: Promise<void>[] = [];
    const defer = async (promise: Promise<void>) => {
        pending.push(promise);
    };
    return { defer, settle: () => Promise.all(pending) };
};

describe("plausibleAnalyticsTracker", () => {
    let fetchMock: ReturnType<typeof mock>;
    let warnMock: ReturnType<typeof mock>;

    beforeEach(() => {
        fetchMock = mock(async () => okResponse());
        globalThis.fetch = fetchMock as unknown as typeof fetch;
        warnMock = mock(() => {});
        console.warn = warnMock as unknown as typeof console.warn;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
    });

    const track = async (context: Partial<AnalyticsRequestContext>) => {
        const { defer, settle } = makeDefer();
        const tracker = createPlausibleAnalyticsTracker({
            analyticsRequestContext: { ...baseContext, ...context },
            defer,
        });
        const returned = tracker({ name: "pageview", path: "/mcp/tool/query-core", props: { tool: "query-core" } });
        await settle();
        return returned;
    };

    it("returns void so it cannot be awaited onto the request path", async () => {
        expect(await track({})).toBeUndefined();
    });

    it("posts the event to the Plausible endpoint", async () => {
        await track({});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe("https://plausible.io/api/event");
        expect(init.method).toBe("POST");
    });

    it("sends an absolute url, not a bare path", async () => {
        await track({});
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({
            domain: "mcp.crystallize.com",
            name: "pageview",
            url: "https://mcp.crystallize.com/mcp/tool/query-core",
            props: { tool: "query-core" },
        });
    });

    it("forwards the real client IP as X-Forwarded-For", async () => {
        await track({});
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const headers = init.headers as Record<string, string>;
        expect(headers["X-Forwarded-For"]).toBe("203.0.113.7");
        expect(headers["User-Agent"]).toBe("Crystallize-MCP-Server");
        expect(headers["Content-Type"]).toBe("application/json");
    });

    it("omits X-Forwarded-For rather than sending an empty one when the IP is unknown", async () => {
        await track({ clientIp: undefined });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers as Record<string, string>).not.toHaveProperty("X-Forwarded-For");
    });

    it("never forwards the client's User-Agent, which Plausible's bot filter would reject", async () => {
        // `node` is Node's default fetch User-Agent and UAInspector reads it as a crawler,
        // so forwarding it means Plausible bins every event from a Node-based MCP client.
        await track({ userAgent: "node" });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["User-Agent"]).toBe("Crystallize-MCP-Server");
    });

    it("sends its own User-Agent when the caller sent none", async () => {
        await track({ userAgent: undefined });
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect((init.headers as Record<string, string>)["User-Agent"]).toBe("Crystallize-MCP-Server");
    });

    it("does nothing when no Plausible domain is configured", async () => {
        await track({ domain: undefined });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does nothing on localhost so dev never reports to production", async () => {
        await track({ origin: "http://localhost:5173" });
        expect(fetchMock).not.toHaveBeenCalled();
        await track({ origin: "http://127.0.0.1:8787" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("does not report from a *.workers.dev preview deploy", async () => {
        await track({ origin: "https://crystallize-mcp-server.someone.workers.dev" });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("still reports from the real custom domain", async () => {
        await track({ origin: "https://mcp.crystallize.com" });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("honours an overridden endpoint", async () => {
        await track({ endpoint: "https://analytics.example.com/api/event" });
        expect((fetchMock.mock.calls[0] as [string, RequestInit])[0]).toBe("https://analytics.example.com/api/event");
    });

    it("warns when Plausible silently drops the event", async () => {
        fetchMock.mockImplementation(async () => droppedResponse());
        await track({});
        expect(warnMock).toHaveBeenCalledTimes(1);
        expect((warnMock.mock.calls[0] as unknown[])[0]).toContain("dropped");
    });

    it("names the client's User-Agent and IP in the drop warning, the only way to tell dc_ip from bot", async () => {
        // We no longer send the client's User-Agent, so a surviving drop means the IP —
        // and these two fields are the only evidence the 202 leaves behind.
        fetchMock.mockImplementation(async () => droppedResponse());
        await track({});
        const payload = (warnMock.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
        expect(payload.clientUserAgent).toBe("claude-code/1.2.3");
        expect(payload.clientIp).toBe("203.0.113.7");
    });

    it("does not warn on a normal accepted event", async () => {
        await track({});
        expect(warnMock).not.toHaveBeenCalled();
    });

    it("swallows network failures so analytics can never fail a tool call", async () => {
        fetchMock.mockImplementation(async () => {
            throw new Error("network down");
        });
        expect(await track({})).toBeUndefined();
        expect(warnMock).toHaveBeenCalledTimes(1);
    });
});
