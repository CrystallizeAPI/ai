/**
 * Which Crystallize environment a request talks to: production or dev.
 *
 * Works like the js-api-client's `shopApiStaging` switch: the caller flips a switch, never types a hostname.
 * The switch is the `X-Crystallize-Environment` header (`dev`), and the dev hostname lives only in the
 * `CRYSTALLIZE_DEV_API_ORIGIN` secret, so it never appears in the repo.
 *
 * The value is a js-api-client `origin` *suffix* (`https://${prefix}${origin}/...`), e.g.
 * `.crystallize.com` → `api.crystallize.com`, `shop-api.crystallize.com`, `pim.crystallize.com`.
 */

export const ENVIRONMENT_HEADER = "X-Crystallize-Environment";
export const PRODUCTION_API_ORIGIN = ".crystallize.com";
export const DEV_API_ORIGIN_SECRET = "CRYSTALLIZE_DEV_API_ORIGIN";

// A suffix is glued straight after `api` / `shop-api` / `pim`, so it must start with `.` or `-`, stay lowercase
// host characters, and end on one — a `/` or `?` would otherwise move the request to another path or host.
const SUFFIX_REGEX = /^[.-][a-z0-9.-]*[a-z0-9]$/;

export type ResolvedApiOrigin = { ok: true; origin: string } | { ok: false; status: 400 | 500; error: string };

/**
 * Turn the header value (if any) into an origin suffix. No header means production.
 * `devOrigin` is the `CRYSTALLIZE_DEV_API_ORIGIN` secret, read only when the caller asks for dev.
 */
export function resolveApiOrigin(environment: string | undefined, devOrigin: string | undefined): ResolvedApiOrigin {
    const name = environment?.trim().toLowerCase();
    if (!name || name === "production") {
        return { ok: true, origin: PRODUCTION_API_ORIGIN };
    }
    if (name !== "dev") {
        return { ok: false, status: 400, error: `Unknown ${ENVIRONMENT_HEADER}: expected "production" or "dev"` };
    }
    if (!devOrigin) {
        return { ok: false, status: 400, error: "The dev environment is not configured on this server" };
    }
    if (!SUFFIX_REGEX.test(devOrigin)) {
        return { ok: false, status: 500, error: `${DEV_API_ORIGIN_SECRET} is not a valid origin suffix` };
    }
    return { ok: true, origin: devOrigin };
}

/** `https://api.crystallize.com`, `https://shop-api-dev.example.test`, ... from a prefix and an origin suffix. */
export function apiBaseUrl(prefix: "api" | "shop-api", origin: string): string {
    return `https://${prefix}${origin}`;
}
