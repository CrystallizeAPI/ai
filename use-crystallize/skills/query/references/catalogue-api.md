# Catalogue API Reference

The Catalogue API provides path-based access to items in your Crystallize tenant. In a storefront it is a
**fallback for one named task**: showing a specific customer's price-list prices. Every other catalogue read,
including item by path, draft preview and hreflang, goes to the Discovery API ([[storefront]]).

## Base URL

```
https://api.crystallize.com/{tenant-identifier}/catalogue
```

Replace `{tenant-identifier}` with your tenant name.

## Authentication

By default, the API is accessible without authentication. You can configure access in the Crystallize App:

1. Go to Settings → API Access
2. Choose your preferred access level
3. Save changes

A restricted Catalogue API takes the `X-Crystallize-Static-Auth-Token` header, or
`X-Crystallize-Access-Token-Id` and `X-Crystallize-Access-Token-Secret`, depending on the level chosen.

## When to Use Catalogue API

| Task                                                | Use                                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A specific customer's price-list price, for display | **Catalogue**, server-side, cached per organisation ([Prices for one customer](#prices-for-one-customer)) |
| Item by path, listings, search, facets, variants    | Discovery `search(filters: { path: { equals } })`, `browse`                                               |
| Editor draft preview                                | Discovery `publicationState: draft`                                                                       |
| hreflang, translated paths, sitemaps                | Discovery, one aliased query per language by `itemId`                                                     |
| The price this customer pays in a cart              | Shop API `hydrate` with the customer on the cart ([[pricing]])                                            |
| A back-office check that a publish landed           | Catalogue (or Core) by path, from a script                                                                |

**It is not a peer of Discovery.** On three tenants (Høiax, Screen Universe, WoolLand) `variants` came back `[]` on
products while `defaultVariant` worked, so a product page built on it showed one variant or none. It did not
reproduce on tools-universe (2026-11-12). If you read variants here at all, check for an empty list.

Its stronger consistency is a reason to use it in **seed and verification scripts** (did every path publish?), not
in the storefront's request path. A storefront that falls back to Catalogue whenever Discovery lags gets two code
paths and two failure modes for one page.

## Query Structure

### Basic Path Query

```graphql
{
    catalogue(language: "en", path: "/shop/plants") {
        name
        path
        type
    }
}
```

`catalogue` also takes `version` (`published` by default, or `draft`; for editor preview use Discovery's
`publicationState: draft` instead) and `pathResolutionMethods`. That one
defaults to `[canonical]`, so an alias, a historic path or a shortcut answers `null` unless you ask for
`alias`, `history`, `shortcut` or `any`.

### Product Query with Variants

```graphql
{
    catalogue(language: "en", path: "/shop/furniture/dining-chair") {
        name
        ... on Product {
            variants {
                sku
                name
                price
                stock
                attributes {
                    attribute
                    value
                }
            }
        }
    }
}
```

### Folder with Children

`children` is deprecated. Read a folder through `subtree`, a cursor connection:

```graphql
{
    catalogue(language: "en", path: "/shop/plants") {
        name
        subtree(first: 20, sortField: treePosition, sort: asc) {
            edges {
                cursor
                node {
                    name
                    path
                    type
                }
            }
            pageInfo {
                hasNextPage
                endCursor
                totalNodes
            }
        }
    }
}
```

`sortField` is `treePosition` (the default), `publishedAt` or `name`, and `type` narrows to `product`,
`document` or `folder`.

### Document Query

```graphql
{
    catalogue(language: "en", path: "/blog/welcome-post") {
        name
        ... on Document {
            components {
                id
                name
                content {
                    ... on RichTextContent {
                        html
                    }
                }
            }
        }
    }
}
```

### Reading a Colors component

A `colors` component returns `ColorsContent`, holding a list of entries. Each entry carries whichever
notations were stored — they are the **same colour** expressed several ways, so select the ones your
frontend actually renders rather than all of them.

```graphql
{
    catalogue(language: "en", path: "/shop/furniture/dining-chair") {
        name
        components {
            id
            content {
                ... on ColorsContent {
                    colors {
                        label
                        hex
                        rgb {
                            r
                            g
                            b
                            a
                        }
                        pantone
                        ral
                    }
                }
            }
        }
    }
}
```

`ColorEntry` exposes `label`, `hex`, `rgb { r g b a }`, `hsl { h s l a }`, `cmyk { c m y k }`,
`pantone` and `ral`. Every field is nullable — an entry only carries the notations that were authored,
so a storefront reading `hex` needs a fallback for entries stored as Pantone only.

Colour **filtering** does not belong here. Discovery does index a Colors component's `hex`, `label` and `ral`
as filter fields, but filter on the Selection or topic that carries the colour name instead: near-identical
hexes do not group into one facet. See [[content-model]] for the modelling rule.

## cURL Example

```bash
curl \
  -X POST \
  -H "Content-Type: application/json" \
  --data '{ "query": "{ catalogue(language: \"en\", path: \"/shop/plants\") { name } }" }' \
  https://api.crystallize.com/furniture/catalogue
```

## Limitations

The Catalogue API does **not** support:

- Full-text search
- Filtering
- Faceting
- Sorting beyond the children of one item (`subtree`)

Use the Discovery API for these capabilities.

## Related Links

- [Crystallize Catalogue API Documentation](https://crystallize.com/docs/developer/apis/catalogue-api)

## Prices for one customer

This is the task the Catalogue API is still for. Discovery knows markets only. The Shop API resolves a customer's
price list for **the cart's** customer (inherited from parent customers), which a throw-away `hydrate` can use as a
price check. The Catalogue API resolves it for **any** customer you name, so this is where a B2B storefront reads an
account's agreed prices for display: server-side, cached per organisation, never from the browser.

```graphql
query ContractPrice($skus: [String!]!, $customers: [String!]) {
    productVariants(skus: $skus, language: "en") {
        sku
        priceVariant(identifier: "nok") {
            price # the list price
            priceFor(count: 10, customerIdentifiers: $customers) {
                price # what this customer pays at this quantity
                identifier # the price list that applied
                modifier
                modifierType
            }
        }
    }
}
```

`customerIdentifiers` is a list, and `priceFor` also takes `customerGroupIdentifiers` and
`marketIdentifiers`. A percentage list applies on top of the variant's volume tiers, and a list aimed at an
organisation resolves for its child customers too — see [[pricing]] for the measurements and the caveats
(`productVariants(skus:)` caps at 150 SKUs, and `priceFor` is slow enough to need caching).

**Size and speed** (Lab Universe):

- `productVariants(skus:)` takes at most 150 SKUs (`TOO_MANY_SKUS_PROVIDED`), and `priceFor` took about 2 s per
  150 SKUs.
- For a whole agreement, read the list once instead: `priceList(identifier:) { productVariants(language:, first:)
  { edges { node { sku priceVariant(identifier:) { priceList(identifier:) { modifier modifierType } } } } } }` took
  3.5 s for 2,211 SKUs. Its `pageInfo.hasNextPage` stays `true` past the last SKU, so stop on an empty page.
- Either way, cache per organisation, and apply the cached rules to the Discovery prices on the page. A slow cache
  miss during a Next.js prerender is cut off.
