import type { AuthContext } from "../contracts/app-context";

/**
 * The MCP client authorizes as the user, not a tenant: one token for `/mcp`, valid on every tenant the user can
 * access. Each tool call names its tenant, and the Core API applies the user's role on that tenant.
 */

export const OAUTH_ACCESS_TOKEN_PREFIX = "crz_oat_";

const MCP_PATH = "/mcp";

export type OAuthEnv = {
    CRYSTALLIZE_OAUTH_API_URL?: string;
    CRYSTALLIZE_MCP_PUBLIC_URL?: string;
};

export const oauthApiUrl = (env: OAuthEnv | undefined): URL | undefined => {
    const value = env?.CRYSTALLIZE_OAUTH_API_URL?.trim();
    return value ? new URL(value) : undefined;
};

/**
 * The URL clients see this server at: `CRYSTALLIZE_MCP_PUBLIC_URL` when set, else the request's own. Clients check
 * the advertised resource against the URL they connected to, so behind a proxy the request URL would not match.
 */
export const mcpPublicUrl = (env: OAuthEnv | undefined, requestUrl: string): string => {
    const value = env?.CRYSTALLIZE_MCP_PUBLIC_URL?.trim();
    return value ? new URL(value).origin : requestUrl;
};

const apiEndpoint = (base: URL, path: string): string => {
    const directory = new URL(base);
    directory.pathname = `${directory.pathname.replace(/\/+$/, "")}/`;
    directory.search = "";
    directory.hash = "";
    return new URL(path, directory).href;
};

export const oauthApiOrigin = (apiUrl: URL): string | undefined => {
    if (apiUrl.protocol !== "https:" || apiUrl.port){
      return undefined;
    }
    return /^api([.-][a-z0-9.-]*[a-z0-9])$/.exec(apiUrl.hostname)?.[1];
};

export const mcpResource = (publicUrl: string) => new URL(MCP_PATH, publicUrl).href;

export const PROTECTED_RESOURCE_METADATA_PATH = `/.well-known/oauth-protected-resource${MCP_PATH}`;

export const protectedResourceMetadata = (publicUrl: string, apiUrl: URL) => ({
    resource: mcpResource(publicUrl),
    authorization_servers: [apiEndpoint(apiUrl, "oauth")],
    bearer_methods_supported: ["header"],
    resource_name: "Crystallize MCP",
});

/** A 401 that starts the OAuth flow (RFC 9728 §5.1), or tells the client to get a new token. */
export const oauthChallenge = (publicUrl: string, error?: "invalid_token") =>
    new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
        status: 401,
        headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": [
                `Bearer resource_metadata="${new URL(PROTECTED_RESOURCE_METADATA_PATH, publicUrl).href}"`,
                ...(error ? [`error="${error}"`] : []),
            ].join(", "),
        },
    });

export type OAuthTenantsResult =
    | { ok: true; tenants: AuthContext["tenants"] }
    | { ok: false; reason: "invalid_token" | "unavailable" };

type OAuthGrantTenantsResponse = {
    tenants?: Array<{ id: string; identifier: string; name: string }>;
};

export const fetchOAuthTenants = async (token: string, apiUrl: URL): Promise<OAuthTenantsResult> => {
    let response: Response;
    try {
        response = await fetch(apiEndpoint(apiUrl, "oauth-grant/tenants"), {
            headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        });
    } catch {
        return { ok: false, reason: "unavailable" };
    }

    if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: "invalid_token" };
    }
    if (!response.ok) {
        return { ok: false, reason: "unavailable" };
    }

    const body = (await response.json()) as OAuthGrantTenantsResponse;
    return {
        ok: true,
        tenants: (body.tenants ?? []).map(({ id, identifier, name }) => ({ id, identifier, name })),
    };
};
