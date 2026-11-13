---
name: query
description: Query Crystallize APIs for product data, content, and commerce information. Use this skill when fetching product catalogs, reading an item by path, listing a category, searching products, typeahead, filtering by attributes or typed specs, faceted navigation, listing cards per colourway (variantGroups), picking a variant on a product page, reading list, market or sale prices and stock, translated paths for hreflang and sitemaps, editor draft preview, paginating results, retrieving cart data, reading a shopper's orders, customers or subscription contracts, building back-office dashboards, or reading any data from Crystallize. Covers the Discovery API (every storefront catalogue read), the Shop API (carts, orders, customers), the Catalogue API (fallback for per-customer price display only) and Core API reads (back office only). Also use when choosing which Crystallize API a frontend should read from, debugging empty or stale Discovery results after a publish or a model change, generated Discovery field names, or any read operation — even if the user doesn't explicitly say "query".
metadata:
    author: Crystallize
    version: "3.0"
---

# Crystallize Query Skill

Read product data, content and commerce data from Crystallize. This skill covers how each read API behaves. Which
API a storefront calls for each task, and in what order, is the **storefront API contract** below, in full in
[[storefront]].

## Consultation Approach

Before writing queries, ask:

1. **Is this a storefront (or any shopper-facing code) or the back office?** It decides the API: see the contract.
2. **Is the data about the catalogue or about a shopper?** Catalogue → Discovery. Cart, the price this customer pays,
   orders, customers, bookings, subscriptions → Shop API.
3. **Does the read run in the browser or on the server?** Only an open Discovery may be called from the browser.
4. **Is the data confidential?** An open Discovery serves everything it indexes to anyone: every price variant
   (`nokPrice`, `wholesalePrice`, …) and every market's price list. Negotiated B2B terms never go there, see
   [[pricing]].
5. **Was the model or content just changed?** Discovery is eventually consistent, see
   [Discovery Indexing](references/discovery-indexing.md).

## The storefront API contract

1. **Discovery API: every catalogue read.** Item by path, category listing, search, typeahead, facets, variant groups,
   translated paths, list and market prices, stock per location, ranking and similarity. It serves published
   content by default and drafts with `publicationState: draft` (editor preview; public on an open tenant). It is
   eventually consistent.
2. **Shop API: everything about a shopper.** Carts, the price for this customer and market, promotions and vouchers,
   `place`, orders created from the cart or directly, payments, pipeline stages on those orders, the shopper's order
   history, customers, bookings, subscription contracts (one store per tenant, see [[subscriptions]]), and locks.
3. **Catalogue API: a fallback for one named task**, per-customer price lists for display
   (`priceFor(customerIdentifiers:)`). It is not a peer of Discovery: `variants` came back `[]` on three tenants while
   `defaultVariant` worked. Draft preview and hreflang are Discovery tasks.
4. **Core API: never in the storefront's request path**, not even server-side with a short cache. It is heavily rate
   limited. It is for seeding, imports, scheduled jobs, webhook receivers, admin and seller tools behind staff login,
   and the few tasks with no Shop API equivalent (subscription usage tracking).
5. **Legacy PIM API: setup and back office only** (pipelines, markets, VAT types, stock locations, subscription
   plans).

The task-by-task table (task → API → call → token → browser or server), the request path per page type and the
resolved contradictions between skills are in [[storefront]]. Writes follow the same contract, see [[mutation]].

### Tokens, scopes, browser and server

| API       | Endpoint                                            | Credential                                                                                                                      | From the browser?                                                   |
| --------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Discovery | `https://api.crystallize.com/{tenant}/discovery`    | None when open (the default), drafts included. `X-Crystallize-Static-Auth-Token` when restricted, server-side only              | Yes if open (any origin). Everything it serves is then public       |
| Shop API  | `https://shop-api.crystallize.com/{tenant}/{route}` | `Authorization: Bearer <JWT>` from `POST …/{tenant}/auth/token`, minted with an access token pair that is **not tenant-scoped** | **No.** CORS allows only Crystallize origins and localhost          |
| Catalogue | `https://api.crystallize.com/{tenant}/catalogue`    | Open, static token, or token pair, as the tenant setting requires                                                               | Only open, published reads. Contract-price reads are server only    |
| Core      | `https://api.crystallize.com/@{tenant}`             | Token pair, session, or plugin bearer                                                                                           | Never (except a presigned upload made on the server, see [[media]]) |
| PIM       | `https://pim.crystallize.com/graphql`               | Token pair; most calls take `tenantId`                                                                                          | Never                                                               |

The Shop JWT is **per tenant, not per shopper**: it answers `orders(customerIdentifier:)` for any identifier. Keep it
on the server, cache it, and refresh it before it expires: the API default is one day, and js-api-client asks for 12
hours. The browser holds only the cart id, in an httpOnly cookie. The token rule for minting is in [[permissions]].

| Route                    | Scope                                | Serves                                                  |
| ------------------------ | ------------------------------------ | ------------------------------------------------------- |
| `/cart`                  | `cart`                               | Carts, wishlists, price context, `place`, booking holds |
| `/cart/admin`            | `cart` + `cart:admin`                | Promotions                                              |
| `/order`                 | `order`                              | Orders, payments, pipeline stages                       |
| `/customer`              | `customer`                           | Shop customers (synced to Core)                         |
| `/subscription-contract` | `subscription-contract` (+ `:admin`) | Contracts. Request a token of its own, see below        |
| `/booking/admin`         | `booking:admin`                      | Reservations, blocks, calendar                          |
| `/lock`                  | `lock`                               | Acquire and release a lock (idempotency guards)         |

`GET https://shop-api.crystallize.com/{tenant}` lists the routes a tenant serves. A token requested with every scope
at once read `/subscription-contract` but answered "Unexpected error" on `create`, while a token scoped to that route
alone worked. Minting, expiry and the error shapes are in [Shop API Queries](references/shop-api-queries.md).

## Discovery API

The schema is **generated per tenant** from its shapes and index settings: filter, facet and sort fields, shape types
and ranking arguments differ between tenants and change after an ignite. Introspect rather than derive names. Shape
types are the identifier in camelCase (`... on tool`, `... on machineUnit`); interfaces keep their capital
(`... on Product`, `... on Folder`, `... on Document`).

Entry points: `search` (all shapes, polymorphic hits), `browse.<shape>` (shape-typed; each needs its own fragment),
`autocomplete` (on `name`; it restricts and pads with score-0 hits, see the reference) and `topics`.

> **Never send an explicit `null`.** `after`, `term`, `context`, `sorting` and `filters` reject `null`
> (`expected string, received null`). Build the argument object conditionally and leave the key out.

### Item by path, and category listings

```graphql
query ItemByPath($path: String!) {
    search(language: en, filters: { path: { equals: $path } }, pagination: { limit: 1 }) {
        hits {
            itemId
            name
            path
            updatedAt
            breadcrumbs {
                name
                path
            }
            ... on tool {
                defaultVariant {
                    sku
                    defaultPrice
                }
            }
        }
    }
}
```

- A full path is unique, but **a last segment is not**: paths are unique only within their folder, so never look an
  item up by its slug with `limit: 1`.
- A category listing is `browse.<shape>(filters: { parentPaths: { equals: "/tools" } })`, which matches at any
  depth, or `Folder.children` for direct children. A `parentPaths` facet gives the subfolders.
- Relations come back in the request's language already, so they need no second lookup to localise them.

### Listing cards and product pages: variantGroups and `variant(selected:)`

Product-level filters match a product as soon as **different** variants satisfy different conditions. To show one card
per colourway, or to require that one variant satisfies the whole filter, read the groups:

```graphql
query Cards($parent: String!) {
    browse {
        product(language: en, filters: { parentPaths: { equals: $parent } }, pagination: { limit: 24 }) {
            hits {
                name
                path
                variantGroups(by: ["colour"], filter: { price_default: { range: { lte: 100 } } }, first: 4) {
                    key
                    matched
                    attributes {
                        attribute
                        value
                    }
                    summary {
                        count
                        price(variant: "default") {
                            min
                            max
                        }
                    }
                    representative {
                        sku
                        defaultPrice
                        firstImage {
                            url
                        }
                    }
                    values(of: "size") {
                        value
                        sku
                        osl: stock(location: "osl")
                    }
                }
            }
        }
    }
}
```

- `variantGroups` **never removes a group** or changes hits, facets or paging: matching groups come first, and the
  rest read `matched: false`. Show the `matched` groups first when a filter is active.
- `summary.price(variant:)` is the "from" price. `values(of:)` gives one entry per size. `stock` and `inStock` take a
  `location`, so alias one per stock location.
- `variantGroups { images }` takes no arguments, and was about 70 % of one listing's payload. Prefer
  `representative { firstImage }`, and trim renditions as [[responsive-images]] shows.
- Group keys can contain spaces and slashes, so URL-encode them in links.
- Tenant fields on a variant need the generated type: `... on ProductVariantForTool { gtin }`.
- On the product page, `variant(selected: [{ attribute: "colour", value: "Red" }])` gives the first variant that
  carries every pair; its `sku` goes into the Shop API `hydrate`. Attribute names and values are case-sensitive.
- `variants(skus:)` takes **one** SKU, and a comma list returns `[]` silently. Use `variants(filter:)` for several.

### Facets and generated filter fields

Facets are in `summary { facets }`, a `Hash`. A selection component becomes **one field per option**
(`specs_extraction_dustClass_m`), filtered with `{ exists: true }`; a numeric is `<path>_number`, filtered with
`range`. `NumberFacet` requires `boundaries`. The naming rules, value shapes and operator traps are in
[Generated field names](references/discovery-api.md#generated-field-names).

**Unset booleans come back `false`.** A boolean component that was never written reads `false` on the hit, so a page,
JSON-LD or an agent can't tell "no" from "not stated" by the value. `equals: false` does **not** match the unset ones;
`exists: false` and `not_equals: true` do. Treat `false` as "not stated" when publishing facts, and don't write
`false` for "unknown" ([[content-model]], [[seo-geo]]).

### Prices and stock

| Need                    | Field                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| List price              | `<variant>Price` (`nokPrice`, `defaultPrice`), the `priceVariants` hash, `<variant>PriceTiers`               |
| "From" price on a card  | `variantGroups.summary.price(variant:)`; sort and filter on `price_<variant>`                                |
| Public market price     | `<variant>PriceFor(marketIdentifiers: [...])`, `<variant>BestPriceListFor(marketIdentifiers:)`               |
| Stock shown on the page | `<location>Stock` per variant (`oslStock`), the `stockLocations` hash; filter on `stock_<location>`          |
| Contract price (B2B)    | **Not Discovery.** The Shop API cart for that customer, or the Catalogue fallback, server-side ([[pricing]]) |

Market prices are slow (about 1.4 s per 100 products per market), so read them only for the SKUs on screen. A new
stock location needs a re-ignite before its field exists.

### Paths per language: hreflang and sitemaps

Discovery has no `hreflangs` field. Read the item's path in every language with one aliased query by `itemId`:

```graphql
query Paths($id: String!) {
    en: search(language: en, filters: { itemId: { equals: $id } }) {
        hits {
            path
            updatedAt
        }
    }
    no: search(language: no, filters: { itemId: { equals: $id } }) {
        hits {
            path
            updatedAt
        }
    }
}
```

Empty `hits` mean the item has no version in that language, so leave that alternate out. A sitemap is one `browse`
per language joined on `itemId`, with `updatedAt` as `lastModified`; it is on every hit. Map tenant language codes to
BCP 47 (`no` → `nb`) and add `x-default`: see [[information-architecture]] and [[seo-geo]].

### Draft preview

```graphql
query Preview($path: String!) {
    search(language: en, publicationState: draft, filters: { path: { equals: $path } }) {
        hits {
            name
            publicationState
            updatedAt
        }
    }
}
```

`publicationState: draft` works on `search`, `autocomplete` and every `browse.<shape>`, and the hits report
`publicationState: "draft"`. Draft preview is this Discovery read, run on the server behind editor login and
**never cached**.

> **On an open Discovery, every draft is public.** `publicationState: draft` needs no credential there: tools-universe
> returned its 541 draft documents to an anonymous request, and another tenant served an unpublished page the same
> way (2026-11-12). Never keep confidential content, prices or embargoed launches in drafts on an open tenant. To
> keep drafts private, restrict Discovery and send `X-Crystallize-Static-Auth-Token`, from the server only. Whether
> a restricted Discovery also accepts the access token pair is unverified.

### Consistency

Publishing is asynchronous. New shapes and components need an ignite. A new schema reaches the nodes over minutes,
and an error answered in that window is cached per query body. Under heavy load Discovery answers HTTP 200 with
`errors: [{ message: "Response Error" }]`. Ship code that reads a new field only after the field answers reliably,
make cached reads fail-safe, and retry on "Response Error". Details in
[Discovery Indexing](references/discovery-indexing.md).

## Shop API reads

All Shop API reads run on the server, with the JWT above.

```graphql
# POST https://shop-api.crystallize.com/{tenant}/cart
query {
    cart(id: "cart-id") {
        id
        state
        items {
            variant {
                sku
            }
            quantity
            price {
                gross
                net
            }
        }
        total {
            gross
            net
            currency
        }
    }
}
```

- `items.price` on a cart is the **line total**; order lines carry the unit price.
- `/order`: read anything you just wrote with `order(id: UUID!)`, and the shopper's history with
  `orders(customerIdentifier:, limit: 100)`. **The listing is a second, eventually consistent store**: new orders
  appear after seconds to minutes, a few never did, and `limit`/`skip` paging is inconsistent. Group by `coreId`. Take
  the identifier from the session, never from the client. See
  [Shop API Order Queries](references/shop-api-order-queries.md).
- `/customer`: `customer(identifier:)`. `/subscription-contract`: `subscriptionContracts(customerIdentifier:)`, on
  tenants whose contracts live on the Shop API ([[subscriptions]]).
- Booking availability is a Shop `/cart` read, and Discovery never serves it ([[bookable-resources]]).

## Catalogue API (fallback)

Use it for the one task that Discovery and the Shop API can't do: showing a **specific customer's** price-list price
on a page, server-side, cached per organisation.

```graphql
query ContractPrice($skus: [String!]!, $customers: [String!]) {
    productVariants(skus: $skus, language: "en") {
        sku
        priceVariant(identifier: "nok") {
            priceFor(count: 1, customerIdentifiers: $customers) {
                price
                identifier
            }
        }
    }
}
```

Don't use it for path reads, listings, preview or hreflang. See [Catalogue API](references/catalogue-api.md).

## Core API reads (back office only)

Core is for admin dashboards, seller and approval queues across customers, imports and reporting, behind your own
server and staff login. It filters orders by `meta`, `pipelineStageIds`, SKU or payment provider, which the Shop API
can't. No Core query takes a `tenantId`, and most root fields return a union, so always select
`... on BasicError { errorName message }`.

```graphql
query ListOrders {
    orders(
        first: 20
        filter: { customer: { identifier: "customer@example.com" } }
        sort: { field: createdAt, direction: desc }
    ) {
        ... on OrderConnection {
            edges {
                node {
                    id
                    total {
                        gross
                        currency
                    }
                }
            }
        }
        ... on BasicError {
            errorName
            message
        }
    }
}
```

See the [Core API Queries Reference](references/core-api.md).

## Best Practices

1. **Follow the contract** - Discovery for catalogue reads, the Shop API for shopper data, Catalogue only for
   per-customer price display, Core never in the request path
2. **Detect the Discovery schema, don't hardcode it** - Introspect filter, facet, sort and ranking fields after each
   ignite
3. **Leave optional arguments out** - Never send `null` to Discovery or the Shop API
4. **Sort with one key, or check the order** - Sort keys apply in schema order, so a secondary `itemId` can replace a
   primary that sorts after it. `score` is safe as the primary, and `{ itemId: asc }` alone is stable for full scans
5. **Request only needed fields** - `facets` cost about 17 KB per read, and image ladders dominate listings; skip
   them in rails and menus
6. **Treat unset booleans as "not stated"** - `false` on a hit may mean never written
7. **Scope `customerIdentifier` on the server** - The Shop JWT is per tenant, not per shopper
8. **Read what you just wrote by id** - `order(id:)`, never the listing, and never the listing for idempotency
9. **Keep confidential prices off Discovery** - When it is open, everything it serves is public
10. **Expect lag after publishing and model changes** - See [Discovery Indexing](references/discovery-indexing.md)

## References

- [Discovery API Reference](references/discovery-api.md) - Search, browse, autocomplete, generated field names, value
  shapes, filters, facets, variants and variant groups, prices, sorting, pagination, paths per language, drafts
- [Discovery Indexing](references/discovery-indexing.md) - Ignite, publish lag, schema propagation, cached errors,
  relations and media at index time, load errors, verifying that a change landed
- [Catalogue API Reference](references/catalogue-api.md) - The per-customer price fallback and its known failure
- [Shop API Queries Reference](references/shop-api-queries.md) - Routes, tokens and scopes, carts, customers,
  subscription contracts
- [Shop API Order Queries Reference](references/shop-api-order-queries.md) - Orders by id or customer, and the order
  store's lag
- [Core API Queries Reference](references/core-api.md) - Back-office reads: items, customers, orders, shapes

## Related skills

[[storefront]] owns the request path per page type and the full API decision table. [[mutation]] covers writes on the
same APIs, and [[js-api-client]] wraps them for JS/TS. Ranking, personalisation and similarity are in
[[vector-ranking]], prices for markets and customers in [[pricing]], and image renditions in [[responsive-images]].
