# Shopper sign-in for an MCP server

The MCP specification makes the server an OAuth 2.1 resource server; something has to be the authorization
server. For a production store that is the shop's identity provider. The two demo stores run their own small,
stateless authorization server, where "signing in" means choosing which demo customer the assistant shops as.

The Crystallize MCP server's own OAuth tokens work only on the Core API, so they can't identify a shopper to a
store. A shop still needs its own identity provider.

## The flow

```
Host ── tools/call whoami (no token) ──▶ /api/mcp ── 401 + WWW-Authenticate: resource_metadata=…
Host ── GET /.well-known/oauth-protected-resource/api/mcp ──▶ authorization_servers: [site]
Host ── GET /.well-known/oauth-authorization-server ──▶ authorize / token / register, PKCE S256, CIMD
Host ── POST /oauth/register (DCR)  or  client_id = its metadata document URL (CIMD)
Browser ─ GET /oauth/authorize?… ──▶ consent page: pick a customer ──▶ POST /oauth/approve
Browser ─ 303 → redirect_uri?code=…&state=…&iss=…
Host ── POST /oauth/token (code + code_verifier) ──▶ access_token (1 h) + refresh_token (30 d, rotating)
Host ── retries with Bearer token ──▶ personalised answer
```

## Lazy authentication

`initialize`, `tools/list` and the public tools never need a token, so the connector works at once. Only tools
that act for the shopper answer 401, and only a **transport-level** 401 makes a host start sign-in; a tool handler
can't produce one. So the gate runs in the route, on the parsed JSON-RPC body, before the SDK:

```ts
export const PROTECTED_TOOLS = new Set(["whoami", "my_orders", "recommendations"]);

function callsProtectedTool(body: unknown): boolean {
    const messages = Array.isArray(body) ? body : [body];
    return messages.some(
        (m) =>
            m &&
            typeof m === "object" &&
            (m as { method?: unknown }).method === "tools/call" &&
            PROTECTED_TOOLS.has(String((m as { params?: { name?: unknown } }).params?.name)),
    );
}

function challenge(req: Request, description: string, error = "invalid_token", status = 401): Response {
    const metadata = `${siteUrl(req)}/.well-known/oauth-protected-resource/api/mcp`;
    return withCors(
        Response.json(
            { error, error_description: description },
            {
                status,
                headers: {
                    "WWW-Authenticate": `Bearer error="${error}", error_description="${description}", resource_metadata="${metadata}", scope="${SCOPE}"`,
                },
            },
        ),
    );
}
```

An invalid or expired token is refused outright with the same challenge, so the client refreshes or re-authorises.
Public tools still personalise when a valid token comes along.

## Discovery documents

RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/api/mcp` (and at the bare
`/.well-known/oauth-protected-resource`), and RFC 8414 authorization-server metadata at
`/.well-known/oauth-authorization-server`:

```ts
export function protectedResourceMetadata(req: Request) {
    return {
        resource: mcpUrl(req),
        authorization_servers: [siteUrl(req)],
        scopes_supported: [SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "My Store MCP",
        resource_documentation: `${siteUrl(req)}/en/mcp`,
    };
}

export function authorizationServerMetadata(req: Request) {
    const issuer = siteUrl(req);
    return {
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        registration_endpoint: `${issuer}/oauth/register`,
        scopes_supported: [SCOPE],
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
    };
}
```

Serve both with CORS and `Cache-Control: public, max-age=300`. For a production store, point
`authorization_servers` at the identity provider and drop the rest of this file.

## A stateless authorization server (demo)

Every artefact (the client registration, the code, the access and refresh tokens, the basket hand-off) is a signed
JWT (HS256, `jose`), each with its own `typ`, so nothing needs a database:

- **Clients.** Dynamic Client Registration (RFC 7591) for public clients: the registration _is_ the `client_id`.
  Client ID Metadata Documents: the `client_id` is an https URL; fetch it, check its `client_id` matches and the
  redirect URI is listed, and show the host's name on the consent page. Claude supports both ("Register
  automatically" and "Use Claude's published identity").
- **Redirect URIs** are https, or http on loopback. Loopback redirects match with the port ignored (RFC 8252
  §7.3), which Claude Code needs.
- **Codes** live 5 minutes, bound to client, redirect URI, PKCE challenge (S256 only) and resource.
- **Access tokens** live 1 hour, with `aud` = the MCP URL; they are rejected anywhere else.
- **Refresh tokens** live 30 days and rotate on every use (a fresh `jti`). They can't be revoked individually:
  fine for a demo, not for production.
- **The token endpoint** accepts form-encoded bodies (and JSON), verifies PKCE, checks `resource` matches, and for
  CIMD clients checks the document still exists on refresh.

```ts
export async function verifyAccessToken(token: string, issuer: string, resource: string): Promise<AuthInfo> {
    try {
        const { payload } = await jwtVerify(token, authSecret(), { issuer, audience: resource, typ: "at+jwt" });
        return {
            token,
            clientId: payload.cid as string,
            scopes: String(payload.scope ?? SCOPE)
                .split(" ")
                .filter(Boolean),
            expiresAt: payload.exp,
            resource: new URL(resource),
            extra: { shopper: payload.sub },
        };
    } catch (error) {
        const expired = error instanceof joseErrors.JWTExpired;
        throw new OAuthError(OAuthErrorCode.InvalidToken, expired ? "Token expired" : "Invalid token");
    }
}
```

The `sub` is the shopper; the tools turn it into the Shop API customer (for a trade buyer, the company), their
price-list markets and their taste.

## The issuer URL

The issuer, the resource identifier and every link handed to the model are built from one function, and must be
stable per deployment:

```ts
export function siteUrl(req?: Request | null): string {
    const explicit = process.env.MCP_SITE_URL?.replace(/\/$/, "");
    if (explicit) return explicit;
    if (req) {
        const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
        const proto =
            req.headers.get("x-forwarded-proto")?.split(",")[0] ??
            (host && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
        if (host) return `${proto}://${host}`;
    }
    if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    return SITE_URL;
}
export const mcpUrl = (req?: Request | null) => `${siteUrl(req)}/api/mcp`;
```

The canonical production URL (for SEO) is deliberately not first: a local or preview server would then issue
tokens for production. Set `MCP_SITE_URL` to the tunnel's origin when testing through a tunnel.

## Environment

| Variable                                  | Purpose                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `CRYSTALLIZE_ACCESS_TOKEN_ID` / `_SECRET` | The Shop API (baskets, orders, bookings). Discovery needs nothing when open |
| `MCP_AUTH_SECRET`                         | Signs the OAuth artefacts and basket hand-offs. A long random string        |
| `MCP_SITE_URL`                            | The public origin for the issuer and links, when the request host isn't it  |

## Browser headers on the OAuth pages

An MCP client may open the consent page in a popup and read the result through `window.opener` after the redirect
back. `Cross-Origin-Opener-Policy: same-origin` cuts that: exclude the OAuth routes from COOP ([[storefront]]
security headers).
