/**
 * A single analytics event, in the shape Plausible's Events API expects.
 *
 * `path` is a pathname only (`/mcp/tool/query-core`) — the tracker turns it into
 * the absolute URL Plausible requires. Sending a bare path to Plausible makes it
 * store the hostname as the literal string `(none)` and fragments sessions.
 */
export type AnalyticsEvent = {
    /** `"pageview"` is special to Plausible; anything else is a custom event that needs a registered goal. */
    name: string;
    /** Pathname, leading slash included. Becomes the page in Plausible's Top Pages report. */
    path: string;
    /**
     * Custom properties. Values must be scalars and there is a hard cap of 30 pairs.
     * Never omit a key conditionally — a missing key renders as `(none)` in the
     * dashboard, so send an explicit placeholder instead.
     */
    props?: Record<string, string>;
};

/**
 * Fire-and-forget analytics.
 *
 * Returns `void`, not a promise, so a caller cannot accidentally `await` it and
 * put a third-party HTTP round-trip on the request path. Delivery is handed to
 * `ctx.waitUntil` and runs after the response has already been sent. Never throws.
 */
export type AnalyticsTracker = (event: AnalyticsEvent) => void;

/**
 * Per-request inputs the tracker needs. Registered on the Awilix request scope
 * rather than the (module-singleton, env-ignoring) root container.
 */
export type AnalyticsRequestContext = {
    /** Plausible site ID. When undefined, tracking is a no-op — this is how dev stays silent. */
    domain?: string;
    /** Plausible Events API endpoint. */
    endpoint: string;
    /** Origin of the incoming request, used to build absolute event URLs. */
    origin: string;
    /** Real client IP, from `CF-Connecting-IP`. Without it Plausible sees our egress IP and drops the event. */
    clientIp?: string;
    /** Inbound `User-Agent`, forwarded so Plausible's visitor hashing and device reports work. */
    userAgent?: string;
};
