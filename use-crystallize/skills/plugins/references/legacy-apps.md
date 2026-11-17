# Legacy Apps (PIM API iframe views)

Before plugins, a tenant could frame any web page in the Crystallize App as an **App**. Apps still work and some
tenants use them, so you will meet them. They are a much smaller contract than plugins: no manifest, no placements,
no scopes, no Backend Token, and no item context.

**Pick a plugin when the view needs the item, order or language the editor is on.** An App only learns the tenant
and the user. Pick an App for a tenant-wide view (a dashboard, a report, an import screen) on a tenant that already
has one, or when a plugin is more than the task needs.

## Register an App

Apps live on the legacy PIM API (`https://pim.crystallize.com/graphql`), with an access token pair. The Core API has
plugin installations but no apps.

```graphql
mutation CreateApp($tenantId: ID!) {
    app {
        create(
            input: {
                tenantId: $tenantId
                identifier: "stock-dashboard"
                name: "Stock dashboard"
                baseUrl: "https://admin.example.com/apps/stock"
            }
        ) {
            identifier
            name
            baseUrl
        }
    }
}
```

- **`baseUrl` must be https.** `http://localhost:3000` is refused with "Invalid URL format, make sure URL contains
  https protocol". Deploy the page, or put a tunnel in front of the dev server, before you register it.
- **`tenantId` is the tenant's id**, not its identifier.
- **Update and delete by identifier**: `app { update(tenantId, identifier, input: { name, baseUrl }) }` (the input
  takes only `name` and `baseUrl`) and `app { delete(tenantId, identifier) }`. Read them with `app { get }` and
  `app { getMany }`.

## What the framed page receives

The App loads `baseUrl` with one query parameter:

```text
https://admin.example.com/apps/stock?crystallizeSignature=<JWT>
```

- The JWT carries the tenant and the signed-in user. It carries **no item id and no language**. A per-item view needs
  its own deep-link parameters and a lookup from the item id to the item (Discovery, or Core from the server).
- **Verify the signature on the server** with the tenant's `signatureSecret`, read from the PIM API:

    ```graphql
    query Secret($id: ID!) {
        tenant {
            get(id: $id) {
                signatureSecret
            }
        }
    }
    ```

    Treat it like any secret: server-side only. `regenerateSecrets` on the tenant rotates it.

## Allow the App to frame the page

The page must allow `https://app.crystallize.com` as a frame ancestor. A page component can't set response headers,
so in Next.js put it in `next.config` `headers()` (or the proxy), scoped to the App's routes:

```js
// next.config.mjs
export default {
    async headers() {
        return [
            {
                source: "/apps/:path*",
                headers: [{ key: "Content-Security-Policy", value: "frame-ancestors https://app.crystallize.com" }],
            },
        ];
    },
};
```

Keep the rest of the site at `frame-ancestors 'self'` (or `none`).

## Custom views (tenant frontends)

Custom views, the tenant's list of frontends as `{ name, url }`, are tenant preferences and are registered only on
the PIM API: `tenant { setPreferences(tenantId, input: { frontends: [{ name, url }] }) }`. The argument is
`tenantId`. Read them back with `tenant { get(id) { preferences { frontends { name url } } } }`.

## Apps versus plugins

| Need                                          | App                                            | Plugin                                     |
| --------------------------------------------- | ---------------------------------------------- | ------------------------------------------ |
| Know the item, order or language being edited | No                                             | Yes, in the decrypted payload              |
| Call Crystallize APIs as the user             | No: bring your own credentials                 | Yes, with the per-load Backend Token       |
| Placement in the App                          | One App entry                                  | Declared placements                        |
| Registration                                  | PIM `app.create`, per tenant                   | `/@me` plugin, revision, approval, install |
| Signature                                     | JWT signed with the tenant's `signatureSecret` | JWE payload encrypted to your key          |
