import type { AnalyticsEvent } from "../contracts/analytics-tracker";
import type { AuthContext } from "../contracts/app-context";
import type { ExposeFlags } from "./expose-flags";

/**
 * Placeholders for a tenant we could not pin down.
 *
 * A leading underscore cannot collide with a real identifier: `tenantSchema`
 * requires those to start and end with `[a-z0-9]`. They are path segments, so
 * unlike the previous `(multiple)` they need no percent-encoding and sort cleanly.
 */
export const UNKNOWN_TENANT = "_unknown";
export const MULTIPLE_TENANTS = "_multiple";

/** Matches `tenantSchema`, so no legitimate identifier is ever truncated into a collision. */
const MAX_TENANT_LENGTH = 128;

/**
 * Bound and canonicalise a value before it becomes a URL path segment.
 *
 * Load-bearing, not cosmetic. Under bearer auth the tenant comes from the
 * `X-Crystallize-Tenant-Identifier` header, which the auth middleware only checks
 * for non-emptiness — an unbounded or slash-bearing value would break the path
 * shape every wildcard goal depends on.
 */
const slugSegment = (value: string, maxLength: number): string => {
    const slug = value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    return slug.length > 0 ? slug.slice(0, maxLength) : UNKNOWN_TENANT;
};

/**
 * Which tenant a tool call was actually about.
 *
 * 14 of the 17 tools take a `tenant` input, and the SDK validates it against
 * `tenantSchema` before the handler runs, so that branch is both the common case
 * and an exact one. Otherwise a credential scoped to exactly one tenant (always
 * true for bearer auth) leaves no ambiguity. Beyond that we do not guess: a
 * token/session credential can see many tenants and picking the first would
 * invent data.
 */
export const resolveTenant = (input: Record<string, unknown>, authContext: AuthContext): string => {
    const fromInput = input.tenant;
    if (typeof fromInput === "string" && fromInput.length > 0) {
        return slugSegment(fromInput, MAX_TENANT_LENGTH);
    }
    if (authContext.tenants.length === 1) {
        return slugSegment(authContext.tenants[0].identifier, MAX_TENANT_LENGTH);
    }
    return authContext.tenants.length > 1 ? MULTIPLE_TENANTS : UNKNOWN_TENANT;
};

/**
 * One MCP tool call.
 *
 * Everything is carried by the path, because custom properties are a Business-plan
 * feature and this account is on Growth. The path is not a cosmetic choice — it is
 * the whole reporting model:
 *
 *   - `/t/{tenant}/{tool}` is one row per (tenant, tool) pair in Top Pages
 *   - a pageview goal `/t/{*}/{tool}` sums one tool across every tenant
 *   - a `Page contains /t/{tenant}/` filter sums one tenant across every tool
 *
 * Plausible compiles a goal's `*` to `.*` anchored `^…$`, evaluates it at query
 * time (so goals are retroactive), and matches every goal a pageview satisfies at
 * once — so all of the above come from this single event, at no extra cost.
 *
 * Tenant first, tool last: the tenant prefix makes the ad-hoc filter a simple
 * `contains`, and anchoring the tool at the end stops `/t/*​/query-core` from
 * bleeding into a longer tool name.
 */
export const buildToolCallEvent = (
    toolName: string,
    input: Record<string, unknown>,
    authContext: AuthContext,
): AnalyticsEvent => ({
    name: "pageview",
    path: `/t/${resolveTenant(input, authContext)}/${toolName}`,
});

const onOff = (value: boolean): string => (value ? "on" : "off");

/**
 * One MCP session handshake: who connected, and with what configuration.
 *
 * Tenant first, mirroring `/t/{tenant}/{tool}`, so `Page contains /mcp/session/{tenant}/`
 * is the same shape of drill-down in both reports.
 *
 * **The tenant is weaker here than on a tool call, by nature.** At handshake time
 * the client has not yet named a tenant, so all we have is the credential's scope:
 * exact for bearer auth (one tenant, from the JWT), but an access token routinely
 * spans several, and those sessions all land on `_multiple`. That is not a gap to
 * plug — the tenant genuinely is not decided yet. It does keep cardinality low,
 * since every multi-tenant token collapses into one row, and the split between
 * named and `_multiple` is itself the plugin-vs-token ratio.
 *
 * The three booleans give eight rows per tenant, so Top Pages shows the *joint*
 * distribution. The marginals ("how many enabled write?") come from three
 * overlapping wildcard goals rather than eight combination goals, because a
 * pageview matches every goal it satisfies. Flag tokens are `/`-delimited, so a
 * tenant that happens to be named `write-on` cannot satisfy a flag goal.
 *
 * The flags cannot ride in a query string: Plausible strips those from the page
 * path, which would collapse every row into one.
 *
 * This counts `initialize` calls, not people — a client that reconnects
 * re-initialises and counts again. Read it as connection handshakes.
 */
export const buildSessionEvent = (
    { write, ui, skills }: ExposeFlags,
    authContext: AuthContext,
): AnalyticsEvent => ({
    name: "pageview",
    path: `/mcp/session/${resolveTenant({}, authContext)}/write-${onOff(write)}/ui-${onOff(ui)}/skills-${onOff(skills)}`,
});
