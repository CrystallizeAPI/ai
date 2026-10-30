import type { McpUiResourceMeta } from "@modelcontextprotocol/ext-apps";
import { PRODUCTION_API_ORIGIN } from "./api-origin";

/**
 * Let a UI panel load images from the environment the request runs on.
 *
 * A tool's `ui.meta` is static and lists production hosts. When the session is on another environment, add that
 * environment's wildcard domain so the panel's CSP admits its media host too. The wildcard is always `*.<parent>`
 * because CSP only accepts `*` as a whole leftmost label: a domain suffix `.example.test` → `*.example.test`, and a
 * host-prefix suffix such as `-dev.example.test` → `*.example.test`.
 */
export function withEnvironmentResourceDomains(
    meta: McpUiResourceMeta | undefined,
    origin: string,
): McpUiResourceMeta | undefined {
    if (!meta || origin === PRODUCTION_API_ORIGIN) return meta;
    const parent = origin.slice(origin.indexOf(".") + 1);
    const domain = `https://*.${parent}`;
    const existing = meta.csp?.resourceDomains ?? [];
    if (existing.includes(domain)) return meta;
    return { ...meta, csp: { ...meta.csp, resourceDomains: [...existing, domain] } };
}
