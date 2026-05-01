#!/usr/bin/env bun
/**
 * Dev-only bridge for testing MCP Apps with the ext-apps basic-host (or any
 * browser-based MCP host that can't send our custom auth headers and needs CORS).
 *
 * Listens on BRIDGE_PORT (default 5174) and forwards to MCP_TARGET (default
 * http://localhost:5173/mcp), injecting:
 *   - X-Crystallize-Access-Token-Id     from CRYSTALLIZE_TOKEN_ID
 *   - X-Crystallize-Access-Token-Secret from CRYSTALLIZE_TOKEN_SECRET
 * and adding permissive CORS headers for the loopback host.
 *
 * Usage (loads .env automatically):
 *   bun run dev:bridge
 *   # then in ext-apps/examples/basic-host:
 *   SERVERS='["http://localhost:5174/mcp"]' npm run start
 */

const TARGET = Bun.env.MCP_TARGET ?? "http://localhost:5173/mcp";
const PORT = Number(Bun.env.BRIDGE_PORT ?? 5174);
const TOKEN_ID = Bun.env.CRYSTALLIZE_TOKEN_ID;
const TOKEN_SECRET = Bun.env.CRYSTALLIZE_TOKEN_SECRET;

if (!TOKEN_ID || !TOKEN_SECRET) {
    console.error("Missing CRYSTALLIZE_TOKEN_ID / CRYSTALLIZE_TOKEN_SECRET in env (.env).");
    process.exit(1);
}

const corsHeaders = (origin: string | null): Record<string, string> => ({
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers":
        "Content-Type, Accept, Authorization, MCP-Protocol-Version, MCP-Session-Id, " +
        "X-Crystallize-Access-Token-Id, X-Crystallize-Access-Token-Secret, X-Crystallize-Session-Id",
    "Access-Control-Expose-Headers": "MCP-Session-Id, MCP-Protocol-Version",
    "Access-Control-Max-Age": "86400",
});

Bun.serve({
    port: PORT,
    async fetch(req) {
        const origin = req.headers.get("origin");

        if (req.method === "OPTIONS") {
            return new Response(null, { status: 204, headers: corsHeaders(origin) });
        }

        const incoming = new URL(req.url);
        const upstream = new URL(TARGET);
        upstream.pathname = incoming.pathname.replace(/^\/mcp/, upstream.pathname.replace(/\/$/, ""));
        upstream.search = incoming.search;

        const fwdHeaders = new Headers(req.headers);
        fwdHeaders.set("X-Crystallize-Access-Token-Id", TOKEN_ID);
        fwdHeaders.set("X-Crystallize-Access-Token-Secret", TOKEN_SECRET);
        fwdHeaders.delete("host");

        const upstreamRes = await fetch(upstream.toString(), {
            method: req.method,
            headers: fwdHeaders,
            body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        });

        const respHeaders = new Headers(upstreamRes.headers);
        for (const [k, v] of Object.entries(corsHeaders(origin))) {
            respHeaders.set(k, v);
        }

        return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            statusText: upstreamRes.statusText,
            headers: respHeaders,
        });
    },
});

console.log(`MCP dev-bridge: http://localhost:${PORT}/mcp  ->  ${TARGET}`);
console.log("Inject auth headers from env. CORS open for any origin.");
