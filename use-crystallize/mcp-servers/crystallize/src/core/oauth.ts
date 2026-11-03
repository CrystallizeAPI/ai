import { apiBaseUrl, PRODUCTION_API_ORIGIN } from "./api-origin";

export const OAUTH_ACCESS_TOKEN_PREFIX = "crz_oat_";

const TENANT_PATH = /^\/mcp\/@([^/?#@\s]+)$/;

export const tenantFromMcpPath = (pathname: string): string | undefined => TENANT_PATH.exec(pathname)?.[1];

export type OAuthEnv = {
    // local development only: where `https://api.crystallize.com` lives (e.g. http://localhost:3001).
    CRYSTALLIZE_LOCAL_API_URL?: string;
};

export const authorizationServer = (env: OAuthEnv) =>
    `${env.CRYSTALLIZE_LOCAL_API_URL ?? apiBaseUrl("api", PRODUCTION_API_ORIGIN)}/oauth`;

export const mcpResource = (requestUrl: string, tenantIdentifier: string) =>
    `${new URL(requestUrl).origin}/mcp/@${tenantIdentifier}`;

export const protectedResourceMetadataUrl = (requestUrl: string, tenantIdentifier: string) =>
    `${new URL(requestUrl).origin}/.well-known/oauth-protected-resource/mcp/@${tenantIdentifier}`;

/** RFC 9728: tells an MCP client which authorization server issues tokens for this tenant. */
export const protectedResourceMetadata = (requestUrl: string, tenantIdentifier: string, env: OAuthEnv) => ({
    resource: mcpResource(requestUrl, tenantIdentifier),
    authorization_servers: [authorizationServer(env)],
    bearer_methods_supported: ["header"],
});

/** A 401 that starts the MCP OAuth flow (RFC 9728 §5.1). */
export const oauthChallenge = (requestUrl: string, tenantIdentifier: string, error?: "invalid_token") =>
    new Response(JSON.stringify({ error: error ?? "unauthorized" }), {
        status: 401,
        headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": [
                `Bearer resource_metadata="${protectedResourceMetadataUrl(requestUrl, tenantIdentifier)}"`,
                ...(error ? [`error="${error}"`] : []),
            ].join(", "),
        },
    });

/**
 * Checks the token against the Core API for the tenant: Core validates it (audience, tenant, user) on every call,
 * so a cheap query is the source of truth here too.
 */
export const isOAuthTokenValid = async (token: string, tenantIdentifier: string, origin: string) => {
    const response = await fetch(`${apiBaseUrl("api", origin)}/@${tenantIdentifier}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query: "{ __typename }" }),
    });
    return response.ok;
};
