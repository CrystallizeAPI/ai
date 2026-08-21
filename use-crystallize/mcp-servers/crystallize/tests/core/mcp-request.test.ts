import { describe, it, expect } from "bun:test";
import { isInitializeRequest } from "../../src/core/mcp-request";

const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://mcp.crystallize.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": String(body.length), ...headers },
        body,
    });

const INITIALIZE = JSON.stringify({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-code", version: "2.1.0" } },
});

describe("isInitializeRequest", () => {
    it("recognises the handshake", async () => {
        expect(await isInitializeRequest(post(INITIALIZE))).toBe(true);
    });

    it("ignores other JSON-RPC methods", async () => {
        const toolCall = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "skills" } });
        expect(await isInitializeRequest(post(toolCall))).toBe(false);
    });

    it("ignores the initialized notification, which is a different request", async () => {
        const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
        expect(await isInitializeRequest(post(notification))).toBe(false);
    });

    it("ignores non-POST requests", async () => {
        expect(await isInitializeRequest(new Request("https://mcp.crystallize.com/mcp"))).toBe(false);
    });

    // The whole point of the size guard: never buffer a big tool-call payload.
    it("skips bodies larger than the peek limit", async () => {
        expect(await isInitializeRequest(post(INITIALIZE, { "Content-Length": "8193" }))).toBe(false);
    });

    it("peeks right up to the limit", async () => {
        expect(await isInitializeRequest(post(INITIALIZE, { "Content-Length": "8192" }))).toBe(true);
    });

    it("skips a streamed body with no declared length", async () => {
        const request = new Request("https://mcp.crystallize.com/mcp", { method: "POST", body: INITIALIZE });
        request.headers.delete("Content-Length");
        expect(await isInitializeRequest(request)).toBe(false);
    });

    it("returns false rather than throwing on a malformed body", async () => {
        expect(await isInitializeRequest(post("{not json"))).toBe(false);
        expect(await isInitializeRequest(post(""))).toBe(false);
    });

    it("returns false for JSON that is not an object", async () => {
        expect(await isInitializeRequest(post('"initialize"'))).toBe(false);
        expect(await isInitializeRequest(post("null"))).toBe(false);
        expect(await isInitializeRequest(post('["initialize"]'))).toBe(false);
    });

    // The load-bearing invariant: app.ts hands the ORIGINAL request to the MCP
    // handler after this runs. If the peek consumed the body, every handshake breaks.
    it("leaves the original body intact for the MCP handler", async () => {
        const request = post(INITIALIZE);
        await isInitializeRequest(request);
        expect(request.bodyUsed).toBe(false);
        expect(await request.text()).toBe(INITIALIZE);
    });

    it("leaves the body intact even when the peek fails to parse", async () => {
        const request = post("{not json");
        await isInitializeRequest(request);
        expect(await request.text()).toBe("{not json");
    });
});
