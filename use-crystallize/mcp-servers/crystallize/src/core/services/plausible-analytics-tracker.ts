import type { AnalyticsEvent, AnalyticsRequestContext, AnalyticsTracker } from "../../contracts/analytics-tracker";

/** Plausible's Events API needs no authentication — the site is identified by the `domain` field alone. */
export const PLAUSIBLE_EVENTS_ENDPOINT = "https://plausible.io/api/event";

/**
 * The User-Agent every event is sent under — ours, never the client's.
 *
 * Plausible runs the User-Agent through UAInspector and drops the event outright
 * when it reads as a crawler (`put_user_agent` -> `drop_bot`). MCP clients send
 * exactly the strings that classifier is built to catch: `node` is Node's default
 * fetch User-Agent and `Claude-User/1.0` is a registered Anthropic agent, and both
 * are binned. Forwarding the caller's User-Agent therefore lost whole clients, and
 * bought nothing: the browser/OS reports it fed are meaningless for MCP traffic.
 *
 * Keep this string boring. Anything resembling a bot, crawler or headless browser
 * puts every server-side event back in the bin, silently and retroactively.
 */
const TRACKER_USER_AGENT = "Crystallize-MCP-Server";

/** Mirrors Plausible's own `captureOnLocalhost: false` default, so `bun dev` never pollutes production stats. */
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);

/**
 * Hostnames that must never report into the production site. `PLAUSIBLE_DOMAIN`
 * lives in top-level `vars`, so it is bound to every deploy — including the
 * `*.workers.dev` preview/versioned URLs wrangler can expose alongside the custom
 * domain. Without this, a preview deploy would file its traffic as production.
 */
const isUntracked = (origin: string): boolean => {
    try {
        const { hostname } = new URL(origin);
        return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".workers.dev");
    } catch {
        return false;
    }
};

type Deps = {
    analyticsRequestContext: AnalyticsRequestContext;
    defer: (promise: Promise<void>) => Promise<void>;
};

/**
 * Fire-and-forget Plausible tracker.
 *
 * Delivery is handed to `defer` (which wraps `ctx.waitUntil`), so the HTTP
 * response is already on its way back to the MCP client before the analytics
 * request is even attempted. The tracker returns `void` so no caller can put
 * this on the critical path by awaiting it, and it swallows every error —
 * analytics must never be able to fail a tool call.
 */
export const createPlausibleAnalyticsTracker = ({ analyticsRequestContext, defer }: Deps): AnalyticsTracker => {
    const { domain, endpoint, origin, clientIp, userAgent } = analyticsRequestContext;

    return (event: AnalyticsEvent): void => {
        // No configured site (local dev, preview deploys) means no tracking. This
        // is the kill switch: unset PLAUSIBLE_DOMAIN and the whole thing is inert.
        if (!domain || isUntracked(origin)) {
            return;
        }

        const send = async (): Promise<void> => {
            try {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        // Deliberately constant — see TRACKER_USER_AGENT. The client's own
                        // User-Agent is kept out of the request and only ever logged on a drop.
                        "User-Agent": TRACKER_USER_AGENT,
                        // Without this Plausible sees our Worker's egress IP — a data-center
                        // address — and silently drops the event. CF-Connecting-IP is the only
                        // reliable client IP inside a Worker; the inbound X-Forwarded-For is absent.
                        // This survives the subrequest because plausible.io is on BunnyCDN, not
                        // Cloudflare; if they ever move to Cloudflare, cross-zone rules would
                        // overwrite this header and every event would start dropping silently.
                        ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
                    },
                    body: JSON.stringify({
                        domain,
                        name: event.name,
                        url: `${origin}${event.path}`,
                        ...(event.props ? { props: event.props } : {}),
                    }),
                });

                // The API answers 202 whether it stored the event or binned it, and never
                // says why. `bot` is now designed out by TRACKER_USER_AGENT, so a surviving
                // drop is almost always `dc_ip`: the resolved client IP is a data-center
                // address, which every cloud-hosted MCP client has. That one is not fixable
                // from here — with no X-Forwarded-For, Plausible falls back to the peer IP,
                // and our Worker's Cloudflare egress is a data-center address too. Log the
                // client's User-Agent and IP anyway: the 202 leaves no other evidence.
                if (response.headers.get("x-plausible-dropped") === "1") {
                    console.warn("[analytics] plausible dropped event", {
                        name: event.name,
                        path: event.path,
                        clientUserAgent: userAgent,
                        clientIp,
                    });
                }
                await response.body?.cancel();
            } catch (error) {
                console.warn("[analytics] plausible send failed", error);
            }
        };

        // Deliberately not awaited. A bare floating fetch() can be cancelled when the
        // response is returned, so it goes through waitUntil rather than nothing at all.
        void defer(send());
    };
};
