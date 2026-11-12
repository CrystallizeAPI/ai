# Security headers

A live Crystallize storefront audited against Modern Web Guidance v1.0 sent only `strict-transport-security`. No
Content Security Policy, no `nosniff`, no Referrer-Policy, no framing protection. This matters more once a store
has agent tools: WebMCP tools act with the shopper's session, so an XSS becomes an agent acting as the shopper.

## Companion headers: always

Cheap, and they break nothing on a typical storefront. From a working `next.config.ts`:

```ts
const nextConfig: NextConfig = {
    async headers() {
        return [
            {
                source: "/:path*",
                headers: [
                    { key: "X-Content-Type-Options", value: "nosniff" },
                    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
                    {
                        key: "Permissions-Policy",
                        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
                    },
                    { key: "X-Frame-Options", value: "SAMEORIGIN" },
                    { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
                ],
            },
            // Not on the OAuth pages: an MCP client may open the consent page in a popup and read the result
            // through window.opener after the redirect back, which COOP: same-origin would cut.
            {
                source: "/:path((?!oauth(?:/|$)|(?:en|no|sv|nl)/oauth(?:/|$)).*)",
                headers: [{ key: "Cross-Origin-Opener-Policy", value: "same-origin" }],
            },
        ];
    },
};
```

- `Permissions-Policy: payment=()` blocks the Payment Request API. Leave `payment` out if a provider's button uses
  it in your page.
- If a payment provider opens a popup and reads `window.opener`, exclude its return route from COOP the same way
  as the OAuth pages, or use `same-origin-allow-popups`.
- `Strict-Transport-Security` usually comes from the host; check it is there.

## Routes embedded in Crystallize

A preview route, a custom view or a legacy App shown inside the Crystallize App must allow it as a frame
ancestor, and only on those routes (from two builds with embedded views):

```ts
async headers() {
    const csp = { key: "Content-Security-Policy", value: "frame-ancestors 'self' https://app.crystallize.com https://*.crystallize.com" };
    return [
        { source: "/app", headers: [csp] },
        { source: "/app/:path*", headers: [csp] },
    ];
}
```

Keep these routes out of the site-wide `frame-ancestors 'self'` and `X-Frame-Options` rule, or the stricter one
wins. Add `http://localhost:*` in development if you embed a local server.

## Content Security Policy

None of the builds enforces a script CSP yet. The audit's recommendation:

- Start with `Content-Security-Policy-Report-Only` and move to enforcing once the reports are clean.
- `script-src` with a nonce or hashes and `'strict-dynamic'`; `object-src 'none'`; `base-uri 'none'`;
  `require-trusted-types-for 'script'`.
- `img-src` names the Crystallize media host (or your custom media domain). Discovery and the Shop API are called
  from the server, so `connect-src` does not need them.
- **A per-request nonce conflicts with a static PPR shell.** A nonce forces dynamic rendering, and hashes don't
  fit streamed inline scripts. With Cache Components, either accept dynamic HTML, or ship the parts of CSP that
  need no nonce (`object-src`, `base-uri`, `frame-ancestors`, `img-src`) and decide the script policy
  explicitly.
- JSON-LD in `<script type="application/ld+json">` is data, but escape `<` so content can't close the tag:

```tsx
export function JsonLd({ data }: { data: unknown }) {
    return (
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
        />
    );
}
```

## The MCP App's CSP

An MCP App resource declares its own CSP to the host. List the store's origin (for the client bundle) and the
media host, and nothing else:

```ts
_meta: { ui: { csp: { resourceDomains: [site, "https://media.crystallize.com"] }, prefersBorder: false } }
```

The MCP endpoint itself answers CORS (`Access-Control-Allow-Origin: *`, and exposes `WWW-Authenticate` and
`Mcp-Session-Id`), because hosts call it from their own origins. See [[agentic-commerce]].

## Cookies

First-party session and cart cookies are `httpOnly`, `SameSite=Lax`, `Path=/`, and should be `Secure` with the
`__Host-` prefix (which requires `Secure`, `Path=/` and no `Domain`). The audited stores had the first three and
lacked `Secure` and the prefix.

```ts
jar.set("__Host-cart", cart.id, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
});
```

The cookie holds the cart id only. Tokens never reach the browser.

## Secrets

- Crystallize token pairs, the Shop JWT, webhook secrets and OAuth signing secrets live in server environment
  variables, never in `NEXT_PUBLIC_*`.
- On Vercel, mark them sensitive.
- The revalidation webhook checks its secret from a header.

## Staging and demo deployments

Several builds send `X-Robots-Tag: noindex, nofollow` site-wide unless an `ALLOW_INDEXING` variable is set, so
previews and staging never get indexed:

```ts
async headers() {
    if (process.env.ALLOW_INDEXING === "true") return [];
    return [{ source: "/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] }];
}
```
